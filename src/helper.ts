import type { MiddlewareFn } from '.'
import type { AnyFunction, ResolvedReturn } from './utils'
import { isThenable } from './utils'

export function onBefore<
	Fn extends AnyFunction,
>(
	callback: (args: Parameters<Fn>) => void,
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
		(args: Parameters<Fn>, error: Err, result: undefined): void
		(args: Parameters<Fn>, error: undefined, result: ResolvedReturn<Fn>): void
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
			return result
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
	callback: (args: Parameters<Fn>, error: Err) => void,
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
			return result
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
	transform: (args: Parameters<Fn>) => Parameters<Fn>,
): MiddlewareFn<Fn> {
	return (context) => {
		return context.nextWith(...transform(context.args))
	}
}
