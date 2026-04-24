import type { MiddlewareFn } from '../src'
import { bench, describe } from 'vitest'
import { middiefy } from '../src'

type SyncFn = (names: string[]) => string
type AsyncFn = (value: number) => Promise<number>

describe('sync dispatch overhead', () => {
	const input = ['zhong666']
	const direct = (names: string[]) => names.join(',')
	const wrappedWithoutMiddleware = middiefy(direct)
	const wrappedWithOnePassthrough = middiefy(direct).add(
		next => names => next(names),
	)
	const wrappedWithThreePassthrough = middiefy(direct).add(
		next => names => next(names),
		next => names => next(names),
		next => names => next(names),
	)

	bench('direct call', () => {
		direct(input)
	})

	bench('wrapped without middleware', () => {
		wrappedWithoutMiddleware(input)
	})

	bench('wrapped with one passthrough middleware', () => {
		wrappedWithOnePassthrough(input)
	})

	bench('wrapped with three passthrough middleware', () => {
		wrappedWithThreePassthrough(input)
	})
})

describe('sync transforming pipeline', () => {
	const input = ['zhong666']
	const direct = (names: string[]) => names.join(',')
	const wrappedWithOneMiddleware = middiefy(direct).add(
		next => names => next([...names, 'other']),
	)
	const wrappedWithThreeMiddleware = middiefy(direct).add(
		next => names => next([...names, 'first']),
		next => names => next([...names, 'second']),
		next => names => next([...names, 'third']),
	)

	bench('direct call', () => {
		direct(input)
	})

	bench('wrapped with one middleware', () => {
		wrappedWithOneMiddleware(input)
	})

	bench('wrapped with three middleware', () => {
		wrappedWithThreeMiddleware(input)
	})
})

describe('async dispatch overhead', () => {
	const direct: AsyncFn = async value => value * 2
	const wrappedWithoutMiddleware = middiefy(direct)
	const wrappedWithOneSyncPassthrough = middiefy(direct).add(
		next => value => next(value),
	)
	const wrappedWithThreeSyncPassthrough = middiefy(direct).add(
		next => value => next(value),
		next => value => next(value),
		next => value => next(value),
	)
	const wrappedWithOneAsyncPassthrough = middiefy(direct).add(
		next => async (value) => {
			return await next(value)
		},
	)

	bench('direct async call', async () => {
		await direct(1)
	})

	bench('wrapped async without middleware', async () => {
		await wrappedWithoutMiddleware(1)
	})

	bench('wrapped async with one sync passthrough middleware', async () => {
		await wrappedWithOneSyncPassthrough(1)
	})

	bench('wrapped async with three sync passthrough middleware', async () => {
		await wrappedWithThreeSyncPassthrough(1)
	})

	bench('wrapped async with one async passthrough middleware', async () => {
		await wrappedWithOneAsyncPassthrough(1)
	})
})

describe('async fallthrough pipeline', () => {
	const direct: AsyncFn = async value => value * 2
	const undefinedThenable: PromiseLike<number | undefined> = {
		then<TResult1 = number | undefined, TResult2 = never>(
			onfulfilled?: ((value: number | undefined) => TResult1 | PromiseLike<TResult1>) | null,
			_onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
		): PromiseLike<TResult1 | TResult2> {
			if (onfulfilled == null)
				return Promise.resolve(undefined as TResult1)
			return Promise.resolve(onfulfilled(undefined))
		},
	}
	const wrappedWithSyncFallthrough = middiefy(direct).add(
		next => async (value) => {
			return await next(value + 1)
		},
		() => () => {
			return undefined
		},
	)
	const wrappedWithAsyncFallthrough = middiefy(direct).add(
		next => async (value) => {
			return await next(value + 1)
		},
		() => async () => {
			await Promise.resolve()
		},
	)
	const wrappedWithThenableFallthrough = middiefy(direct).add(
		next => async (value) => {
			return await next(value + 1)
		},
		() => () => undefinedThenable,
	)
	const wrappedWithSyncPassthroughAndThenableFallthrough = middiefy(direct).add(
		next => value => next(value + 1),
		() => () => undefinedThenable,
	)

	bench('wrapped async with sync fallthrough', async () => {
		await wrappedWithSyncFallthrough(1)
	})

	bench('wrapped async with async fallthrough', async () => {
		await wrappedWithAsyncFallthrough(1)
	})

	bench('wrapped async with thenable fallthrough', async () => {
		await wrappedWithThenableFallthrough(1)
	})

	bench('wrapped async with sync middleware and thenable fallthrough', async () => {
		await wrappedWithSyncPassthroughAndThenableFallthrough(1)
	})
})

describe('mutation-heavy pipeline', () => {
	const input = ['zhong666']
	const direct: SyncFn = names => names.join(',')
	const appendOther: MiddlewareFn<SyncFn> = next => names => next([...names, 'other'])
	const appendFirst: MiddlewareFn<SyncFn> = next => names => next([...names, 'first'])
	const shortCircuit = middiefy(direct).add(
		() => () => 'blocked',
	)
	const repeatedNext = middiefy(direct).add(
		next => (names) => {
			const result = next([...names, 'first'])
			next([...names, 'second'])
			return result
		},
	)
	const churn = middiefy(direct)

	bench('short-circuit return', () => {
		shortCircuit(input)
	})

	bench('repeated next reuse', () => {
		repeatedNext(input)
	})

	bench('add/remove churn', () => {
		churn.add(appendOther, appendFirst)
		churn.remove(appendOther)
		churn.remove(appendFirst)
	})
})
