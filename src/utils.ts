export type AnyFunction = (...args: any[]) => any

export type ResolvedReturn<Fn extends AnyFunction> = Awaited<ReturnType<Fn>>

export function isThenable(
	value: unknown,
): value is PromiseLike<any> {
	if (value == null)
		return false

	const valueType = typeof value
	if (valueType !== 'object' && valueType !== 'function')
		return false

	return typeof (value as PromiseLike<any>).then === 'function'
}
