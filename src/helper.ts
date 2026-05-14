import type { MiddlewareArgs, MiddlewareFn } from '.'
import type { AnyFunction, ResolvedReturn } from './utils'
import { isThenable } from './utils'

export function onBefore<
	Fn extends AnyFunction,
>(
	callback: (args: MiddlewareArgs<Fn>) => void,
): MiddlewareFn<Fn> {
	return (context) => {
		callback(context.args)
	}
}

export function onAfter<
	Fn extends AnyFunction,
	Err = unknown,
>(
	callback: {
		(args: MiddlewareArgs<Fn>, error: Err, result: undefined): void
		(args: MiddlewareArgs<Fn>, error: undefined, result: ResolvedReturn<Fn>): void
	},
): MiddlewareFn<Fn> {
	return (context) => {
		try {
			const result = context.next()
			if (isThenable(result)) {
				return result.then(
					(resolved: ResolvedReturn<Fn>) => {
						callback(context.args, undefined, resolved)
						return resolved
					},
					(error: Err) => {
						callback(context.args, error, undefined)
						throw error
					},
				)
			}
			callback(context.args, undefined, result as ResolvedReturn<Fn>)
		}
		catch (error) {
			callback(context.args, error as Err, undefined)
			throw error
		}
	}
}

export function onError<
	Fn extends AnyFunction,
	Err = unknown,
>(
	callback: (args: MiddlewareArgs<Fn>, error: Err) => void,
): MiddlewareFn<Fn> {
	return (context) => {
		try {
			const result = context.next()
			if (isThenable(result)) {
				return result.then(undefined, (error: Err) => {
					callback(context.args, error)
					throw error
				})
			}
		}
		catch (error) {
			callback(context.args, error as Err)
			throw error
		}
	}
}

export function transformArgs<
	Fn extends AnyFunction,
>(
	transform: (args: MiddlewareArgs<Fn>) => Parameters<Fn>,
): MiddlewareFn<Fn> {
	return (context) => {
		return context.next(...transform(context.args))
	}
}
