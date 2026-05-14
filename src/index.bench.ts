import type { MiddlewareFn } from '../'
import { bench, describe } from 'vitest'
import { middiefy } from '../'

type SyncFn = (names: string[]) => string
type AsyncFn = (value: number) => Promise<number>

const syncFn: SyncFn = names => names.join(',')
const asyncFn: AsyncFn = async value => value * 2

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

// ── Sync passthrough overhead ───────────────────────────────────────────────

describe('sync passthrough: no middleware', () => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn)

	bench('baseline', () => {
		syncFn(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

describe('sync passthrough: one middleware', () => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn).add(ctx => ctx.next())

	bench('baseline', () => {
		;((names: string[]) => syncFn(names))(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

describe('sync passthrough: three middlewares', () => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn).add(
		ctx => ctx.next(),
		ctx => ctx.next(),
		ctx => ctx.next(),
	)

	bench('baseline', () => {
		;((n: string[]) => ((n: string[]) => ((n: string[]) => syncFn(n))(n))(n))(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

// ── Sync transforming pipeline ──────────────────────────────────────────────

describe('sync transform: one middleware', () => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn).add((context) => {
		const [names] = context.args
		return context.nextWith([...names, 'other'])
	})

	bench('baseline', () => {
		;((names: string[]) => syncFn([...names, 'other']))(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

describe('sync transform: three middlewares', () => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn).add(
		(context) => {
			const [names] = context.args
			return context.nextWith([...names, 'first'])
		},
		(context) => {
			const [names] = context.args
			return context.nextWith([...names, 'second'])
		},
		(context) => {
			const [names] = context.args
			return context.nextWith([...names, 'third'])
		},
	)

	bench('baseline', () => {
		;((n: string[]) =>
			((n: string[]) =>
				((n: string[]) => syncFn([...n, 'third'])
				)([...n, 'second'])
			)([...n, 'first'])
		)(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

// ── Async passthrough overhead ──────────────────────────────────────────────

describe('async passthrough: no middleware', () => {
	const wrapped = middiefy(asyncFn)

	bench('baseline', async () => {
		await asyncFn(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

describe('async passthrough: one sync middleware', () => {
	const wrapped = middiefy(asyncFn).add(ctx => ctx.next())

	bench('baseline', async () => {
		await ((value: number) => asyncFn(value))(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

describe('async passthrough: three sync middlewares', () => {
	const wrapped = middiefy(asyncFn).add(
		ctx => ctx.next(),
		ctx => ctx.next(),
		ctx => ctx.next(),
	)

	bench('baseline', async () => {
		await ((v: number) => ((v: number) => ((v: number) => asyncFn(v))(v))(v))(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

describe('async passthrough: one async middleware', () => {
	const wrapped = middiefy(asyncFn).add(async ctx => await ctx.next())

	bench('baseline', async () => {
		await (async (value: number) => await asyncFn(value))(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

// ── Async fallthrough pipeline ──────────────────────────────────────────────

describe('async fallthrough: sync short-circuit', () => {
	// first calls nextWith(value+1), second returns undefined → fallthrough → asyncFn(value+1)
	const wrapped = middiefy(asyncFn).add(
		async (context) => {
			const [value] = context.args
			return await context.nextWith(value + 1)
		},
		() => undefined,
	)

	bench('baseline', async () => {
		await (async (value: number) => await asyncFn(value + 1))(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

describe('async fallthrough: async fallthrough', () => {
	const wrapped = middiefy(asyncFn).add(
		async (context) => {
			const [value] = context.args
			return await context.nextWith(value + 1)
		},
		async () => { await Promise.resolve() },
	)

	bench('baseline', async () => {
		await (async (value: number) => {
			await Promise.resolve()
			return asyncFn(value + 1)
		})(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

describe('async fallthrough: thenable fallthrough', () => {
	const wrapped = middiefy(asyncFn).add(
		async (context) => {
			const [value] = context.args
			return await context.nextWith(value + 1)
		},
		() => undefinedThenable,
	)

	bench('baseline', async () => {
		await (async (value: number) => {
			await undefinedThenable
			return asyncFn(value + 1)
		})(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

describe('async fallthrough: sync middleware + thenable fallthrough', () => {
	const wrapped = middiefy(asyncFn).add(
		(context) => {
			const [value] = context.args
			return context.nextWith(value + 1)
		},
		() => undefinedThenable,
	)

	bench('baseline', async () => {
		await (async (value: number) => {
			await undefinedThenable
			return asyncFn(value + 1)
		})(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

// ── Mutation-heavy pipeline ─────────────────────────────────────────────────

describe('sync short-circuit return', () => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn).add(() => 'blocked')

	bench('baseline', () => {
		;((_names: string[]) => 'blocked')(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

describe('sync repeated next guard', () => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn).add(
		(context) => {
			const [names] = context.args
			const result = context.nextWith([...names, 'first'])
			try {
				context.nextWith([...names, 'second'])
			}
			catch {}
			return result
		},
	)

	bench('baseline', () => {
		;((names: string[]) => {
			const result = syncFn([...names, 'first'])
			try {
				throw new Error('middiefy: next() can only be called once per middleware')
			}
			catch {}
			return result
		})(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

describe('middleware add/remove churn', () => {
	const appendOther: MiddlewareFn<SyncFn> = (context) => {
		const [names] = context.args
		return context.nextWith([...names, 'other'])
	}
	const appendFirst: MiddlewareFn<SyncFn> = (context) => {
		const [names] = context.args
		return context.nextWith([...names, 'first'])
	}
	const wrapped = middiefy(syncFn)
	const set = new Set<MiddlewareFn<SyncFn>>()

	bench('baseline', () => {
		set.add(appendOther)
		set.add(appendFirst)
		set.delete(appendOther)
		set.delete(appendFirst)
	})
	bench('middiefy', () => {
		wrapped.add(appendOther, appendFirst)
		wrapped.remove(appendOther)
		wrapped.remove(appendFirst)
	})
})

// ── Lazy short-circuit rebuild cost ────────────────────────────────────────

describe('lazy short-circuit rebuild', () => {
	const input = ['zhong666']
	const shortCircuit: MiddlewareFn<SyncFn> = () => 'blocked'
	const passthroughMiddlewares: MiddlewareFn<SyncFn>[] = [
		ctx => ctx.next(),
		ctx => ctx.next(),
		ctx => ctx.next(),
		ctx => ctx.next(),
		ctx => ctx.next(),
	]
	const wrapped = middiefy(syncFn)

	bench('baseline', () => {
		const all = [shortCircuit, ...passthroughMiddlewares]
		const composed = all.reduceRight<SyncFn>(
			(next, mw) => (...args) => {
				const r = mw({
					args,
					next: () => next(...args),
					nextWith: (...newArgs) => next(...newArgs),
				})
				return (r === undefined ? next(...args) : r) as string
			},
			syncFn,
		)
		composed(input)
	})
	bench('middiefy', () => {
		wrapped.add(shortCircuit, ...passthroughMiddlewares)
		wrapped(input)
		wrapped.remove(shortCircuit)
		for (const middleware of passthroughMiddlewares)
			wrapped.remove(middleware)
	})
})
