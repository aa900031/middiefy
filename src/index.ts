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

export interface MiddlewareNextFn<
	Fn extends AnyFunction,
> {
	(): ReturnType<Fn>
	(...args: Parameters<Fn>): ReturnType<Fn>
}

export interface MiddlewareContext<
	Fn extends AnyFunction,
> {
	readonly next: MiddlewareNextFn<Fn>
	readonly args: Parameters<Fn>
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
		let nextCalled = false
		let nextResult!: ReturnType<Fn>

		const context: MiddlewareContext<Fn> = {
			args,
			next: (...nextArgs: Parameters<Fn>) => {
				if (nextCalled)
					throw new Error('middiefy: next() can only be called once per middleware')

				nextCalled = true
				nextResult = downstream(nextArgs.length === 0 ? args : nextArgs)
				return nextResult
			},
		}

		const result = middleware(context)
		if (result === undefined)
			return nextCalled ? nextResult : context.next()
		if (nextCalled && result === nextResult)
			return result as ReturnType<Fn>
		if (isThenable(result)) {
			return result.then((resolved: any) => {
				if (resolved !== undefined)
					return resolved
				return nextCalled ? nextResult : context.next()
			}) as ReturnType<Fn>
		}
		return result as ReturnType<Fn>
	}
}
