import type { BenchRegistration } from 'vitest'
import type { MiddlewareFn } from './'
import { it } from 'vitest'
import { middiefy } from './'

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

type Benchmark = (name: string, fn: () => unknown) => void

function benchmark(name: string, define: (bench: Benchmark) => void) {
	it(name, async ({ bench }) => {
		const benchmarks: BenchRegistration<string>[] = []
		define((name, fn) => benchmarks.push(bench(name, fn)))
		// eslint-disable-next-line test/consistent-test-it
		await bench.compare(...benchmarks)
	})
}

// ── Sync passthrough overhead ───────────────────────────────────────────────

benchmark('sync passthrough: no middleware', (bench) => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn)

	bench('baseline', () => {
		syncFn(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

benchmark('sync passthrough: one middleware', (bench) => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn).add(ctx => ctx.next())

	bench('baseline', () => {
		;((names: string[]) => syncFn(names))(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

benchmark('sync passthrough: three middlewares', (bench) => {
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

benchmark('sync transform: one middleware', (bench) => {
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

benchmark('sync transform: three middlewares', (bench) => {
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

benchmark('async passthrough: no middleware', (bench) => {
	const wrapped = middiefy(asyncFn)

	bench('baseline', async () => {
		await asyncFn(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

benchmark('async passthrough: one sync middleware', (bench) => {
	const wrapped = middiefy(asyncFn).add(ctx => ctx.next())

	bench('baseline', async () => {
		await ((value: number) => asyncFn(value))(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

benchmark('async passthrough: three sync middlewares', (bench) => {
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

benchmark('async passthrough: one async middleware', (bench) => {
	const wrapped = middiefy(asyncFn).add(async ctx => await ctx.next())

	bench('baseline', async () => {
		await (async (value: number) => await asyncFn(value))(1)
	})
	bench('middiefy', async () => {
		await wrapped(1)
	})
})

// ── Async fallthrough pipeline ──────────────────────────────────────────────

benchmark('async fallthrough: sync short-circuit', (bench) => {
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

benchmark('async fallthrough: async fallthrough', (bench) => {
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

benchmark('async fallthrough: thenable fallthrough', (bench) => {
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

benchmark('async fallthrough: sync middleware + thenable fallthrough', (bench) => {
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

benchmark('sync short-circuit return', (bench) => {
	const input = ['zhong666']
	const wrapped = middiefy(syncFn).add(() => 'blocked')

	bench('baseline', () => {
		;((_names: string[]) => 'blocked')(input)
	})
	bench('middiefy', () => {
		wrapped(input)
	})
})

benchmark('sync repeated next guard', (bench) => {
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

benchmark('middleware add/remove churn', (bench) => {
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

benchmark('lazy short-circuit rebuild', (bench) => {
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
				return (r === undefined
					? next(...args)
					: r) as string
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
