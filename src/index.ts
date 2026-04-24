export interface Middiefy<T extends AnyFunction> {
	(...args: Parameters<T>): ReturnType<T>
	add: (...middleware: MiddlewareFn<T>[]) => Middiefy<T>
	remove: (middleware: MiddlewareFn<T>) => Middiefy<T>
}

export type MiddlewareFn<
	Fn extends AnyFunction,
	Result extends MiddlewareReturn<Fn> = MiddlewareReturn<Fn>,
> = (next: MiddlewareNextFn<Fn>) => (...args: Parameters<Fn>) => Result | void

export interface MiddlewareNextFn<
	Fn extends AnyFunction,
> {
	(): ReturnType<Fn>
	(...args: Parameters<Fn>): ReturnType<Fn>
}

export function middiefy<Fn extends AnyFunction>(
	fn: Fn,
): Middiefy<Fn> {
	const middleware = new Set<MiddlewareFn<Fn>>()
	let dispatch: DispatchFn<Fn> | undefined
	const wrapper = (...args: Parameters<Fn>): ReturnType<Fn> => {
		if (middleware.size === 0)
			return fn(...args)
		return getter()(args)
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

	function getter(): DispatchFn<Fn> {
		return dispatch ??= createDispatch(fn, Array.from(middleware))
	}
}

export function onBefore<
	Fn extends AnyFunction,
>(
	callback: (args: Parameters<Fn>) => void,
): MiddlewareFn<Fn> {
	return () => (...args) => {
		callback(args)
	}
}

export function onAfter<
	Fn extends AnyFunction,
	Err = unknown,
>(
	callback: {
		(args: Parameters<Fn>, error: Err, result: undefined): void
		(args: Parameters<Fn>, error: undefined, result: ResolvedReturn<Fn>): void
	},
): MiddlewareFn<Fn> {
	return next => (...args) => {
		try {
			const result = next(...args)
			if (isNativePromise(result) || isPromiseLike(result)) {
				return result.then(
					(resolved: ResolvedReturn<Fn>) => {
						callback(args, undefined, resolved)
						return resolved
					},
					(error: Err) => {
						callback(args, error, undefined)
						// throw error
					},
				)
			}
			callback(args, undefined, result as ResolvedReturn<Fn>)
		}
		catch (error) {
			callback(args, error as Err, undefined)
			throw error
		}
	}
}

export function onError<
	Fn extends AnyFunction,
	Err = unknown,
>(
	callback: (args: Parameters<Fn>, error: Err) => void,
): MiddlewareFn<Fn> {
	return next => (...args) => {
		try {
			const result = next(...args)
			if (isNativePromise(result) || isPromiseLike(result)) {
				return result.then(undefined, (error: Err) => {
					callback(args, error)
					// throw error
				})
			}
		}
		catch (error) {
			callback(args, error as Err)
			throw error
		}
	}
}

export function transformArgs<
	Fn extends AnyFunction,
>(
	transform: (args: Parameters<Fn>) => Parameters<Fn>,
): MiddlewareFn<Fn> {
	return next => (...args) => next(...transform(args)) as MiddlewareReturn<Fn>
}

type AnyFunction = (...args: any[]) => any

type MiddlewareReturn<Fn extends AnyFunction>
	= ReturnType<Fn> extends PromiseLike<infer Resolved>
		? ReturnType<Fn> | PromiseLike<Resolved | undefined> | undefined
		: ReturnType<Fn> | undefined

type ResolvedReturn<Fn extends AnyFunction> = Awaited<ReturnType<Fn>>

type DispatchFn<Fn extends AnyFunction> = (args: Parameters<Fn>) => ReturnType<Fn>

function createDispatch<Fn extends AnyFunction>(
	fn: Fn,
	middleware: MiddlewareFn<Fn>[],
): DispatchFn<Fn> {
	let dispatch: DispatchFn<Fn> = args => fn(...args)

	for (let index = middleware.length - 1; index >= 0; index--) {
		const current = middleware[index]
		const downstream = dispatch

		dispatch = (args) => {
			let nextCalled = false
			let nextResult!: ReturnType<Fn>
			let nextErrored = false
			let nextError: unknown

			const next: MiddlewareNextFn<Fn> = (...argsFromNext: Parameters<Fn> | []) => {
				if (nextCalled) {
					if (nextErrored)
						throw nextError
					return nextResult
				}
				nextCalled = true
				try {
					nextResult = downstream((argsFromNext.length === 0 ? args : argsFromNext) as Parameters<Fn>)
					return nextResult
				}
				catch (error) {
					nextErrored = true
					nextError = error
					throw error
				}
			}

			const result = current(next)(...args)
			if (result === undefined)
				return next()
			if (nextCalled && result === nextResult)
				return result as ReturnType<Fn>
			if (result instanceof Promise || isPromiseLike(result))
				return result.then((resolved: any) => resolved === undefined ? next() : resolved) as ReturnType<Fn>
			return result as ReturnType<Fn>
		}
	}

	return dispatch
}

function isPromiseLike(
	value: unknown,
): value is PromiseLike<any> {
	return value != null
		&& typeof value === 'object'
		&& 'then' in value
		&& typeof value.then === 'function'
}

function isNativePromise(
	value: unknown,
): value is Promise<any> {
	return value instanceof Promise
}
