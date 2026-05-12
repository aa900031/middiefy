import type { MiddlewareFn } from '.'
import type { AnyFunction, ResolvedReturn } from './utils'
import { isThenable } from './utils'

export function onBefore<
	Fn extends AnyFunction,
>(
	callback: (args: Parameters<Fn>) => void,
): MiddlewareFn<Fn> {
	return (_next, args) => {
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
	return (next, args) => {
		try {
			const result = next()
			if (isThenable(result)) {
				return result.then(
					(resolved: ResolvedReturn<Fn>) => {
						callback(args, undefined, resolved)
						return resolved
					},
					(error: Err) => {
						callback(args, error, undefined)
						throw error
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
	return (next, args) => {
		try {
			const result = next()
			if (isThenable(result)) {
				return result.then(undefined, (error: Err) => {
					callback(args, error)
					throw error
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
	return (next, args) => next(transform(args))
}
