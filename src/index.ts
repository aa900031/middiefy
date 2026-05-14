import type { AnyFunction } from './utils'
import { isThenable } from './utils'

export interface Middiefy<T extends AnyFunction> {
	(...args: Parameters<T>): ReturnType<T>
	add: (...middleware: MiddlewareFn<T>[]) => Middiefy<T>
	remove: (middleware: MiddlewareFn<T>) => Middiefy<T>
}

export type MiddlewareFn<
	Fn extends AnyFunction,
> = (context: MiddlewareContext<Fn>) => MiddlewareReturn<Fn> | void

export type MiddlewareReturn<Fn extends AnyFunction>
	= ReturnType<Fn> extends PromiseLike<infer Resolved>
		? ReturnType<Fn> | PromiseLike<Resolved | undefined> | undefined
		: ReturnType<Fn> | undefined

export interface MiddlewareContext<
	Fn extends AnyFunction,
> {
	readonly args: Parameters<Fn>
	next: () => ReturnType<Fn>
	nextWith: (...args: Parameters<Fn>) => ReturnType<Fn>
}

export function middiefy<Fn extends AnyFunction>(
	fn: Fn,
): Middiefy<Fn> {
	const middleware = new Set<MiddlewareFn<Fn>>()
	let dispatch: DispatchFn<Fn> | undefined
	const wrapper = (...args: Parameters<Fn>): ReturnType<Fn> => {
		if (middleware.size === 0)
			return fn(...args)

		if (!dispatch)
			dispatch = createDispatch(fn, Array.from(middleware))

		return dispatch(args)
	}
	wrapper.add = (...middlewareFns: MiddlewareFn<Fn>[]) => {
		let changed = false
		for (const middlewareFn of middlewareFns) {
			const size = middleware.size
			middleware.add(middlewareFn)
			if (middleware.size !== size)
				changed = true
		}
		if (changed)
			dispatch = undefined
		return wrapper
	}
	wrapper.remove = (middlewareFn: MiddlewareFn<Fn>) => {
		if (middleware.delete(middlewareFn))
			dispatch = undefined
		return wrapper
	}

	return wrapper
}

type DispatchFn<Fn extends AnyFunction> = (args: Parameters<Fn>) => ReturnType<Fn>

class ContextImpl<Fn extends AnyFunction> implements MiddlewareContext<Fn> {
	nextCalled = false
	nextResult: ReturnType<Fn> | undefined

	constructor(
		readonly args: Parameters<Fn>,
		private readonly downstream: DispatchFn<Fn>,
	) {}

	next(): ReturnType<Fn> {
		if (this.nextCalled)
			throw new Error('middiefy: next() can only be called once per middleware')
		this.nextCalled = true
		this.nextResult = this.downstream(this.args)
		return this.nextResult!
	}

	nextWith(...args: Parameters<Fn>): ReturnType<Fn> {
		if (this.nextCalled)
			throw new Error('middiefy: next() can only be called once per middleware')
		this.nextCalled = true
		this.nextResult = this.downstream(args)
		return this.nextResult!
	}
}

function createDispatch<Fn extends AnyFunction>(
	fn: Fn,
	middleware: MiddlewareFn<Fn>[],
): DispatchFn<Fn> {
	let tail: DispatchFn<Fn> = args => fn(...args)
	for (let i = middleware.length - 1; i >= 0; i--)
		tail = composeMiddlewareLayer(tail, middleware[i])
	return tail
}

function composeMiddlewareLayer<Fn extends AnyFunction>(
	downstream: DispatchFn<Fn>,
	middleware: MiddlewareFn<Fn>,
): DispatchFn<Fn> {
	return (args: Parameters<Fn>): ReturnType<Fn> => {
		const ctx = new ContextImpl<Fn>(args, downstream)
		const result = middleware(ctx)

		if (result === undefined)
			return ctx.nextCalled ? ctx.nextResult! : ctx.next()
		if (ctx.nextCalled && result === ctx.nextResult)
			return result as ReturnType<Fn>
		if ((result instanceof Promise) || isThenable(result)) {
			return result.then((resolved: any) => {
				if (resolved !== undefined)
					return resolved
				return ctx.nextCalled ? ctx.nextResult : ctx.next()
			}) as ReturnType<Fn>
		}
		return result as ReturnType<Fn>
	}
}
