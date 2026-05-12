import type { MiddlewareFn } from '.'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { middiefy } from '.'

describe('middiefy', () => {
	const fn = vi.fn<SyncFn>((name: string[]): string => {
		return `Hello ${name.join(',')}`
	})

	beforeEach(() => {
		fn.mockClear()
	})

	it('returns a callable wrapper with add and remove', () => {
		const wrapped = middiefy<SyncFn>(fn)
		expect(wrapped).toBeTypeOf('function')
		expect(wrapped.add).toBeTypeOf('function')
		expect(wrapped.remove).toBeTypeOf('function')
		expectTypeOf(wrapped).toBeFunction()
		expectTypeOf(wrapped).parameter(0).toExtend<string[]>()
		expectTypeOf(wrapped).returns.toExtend<string>()

		const result = wrapped(['zhong666'])
		expect(result).toBe('Hello zhong666')
		expect(fn).toHaveBeenCalledOnce()
	})

	it('runs middleware in onion order and allows argument transforms', () => {
		const steps: string[] = []
		const wrapped = middiefy<SyncFn>((names) => {
			steps.push(`fn:${names.join(',')}`)
			return `Hello ${names.join(',')}`
		})

		wrapped.add(
			(next, [names]) => {
				steps.push('enter:1')
				const result = next([[...names, 'first']])
				steps.push('exit:1')
				return result
			},
			(next, [names]) => {
				steps.push('enter:2')
				const result = next([[...names, 'second']])
				steps.push('exit:2')
				return result
			},
		)

		const result = wrapped(['zhong666'])
		expect(result).toBe('Hello zhong666,first,second')
		expect(steps).toEqual([
			'enter:1',
			'enter:2',
			'fn:zhong666,first,second',
			'exit:2',
			'exit:1',
		])
	})

	it('treats undefined as implicit fallthrough', () => {
		const steps: string[] = []
		const wrapped = middiefy<SyncFn>((names) => {
			steps.push(`fn:${names.join(',')}`)
			return names.join(',')
		})

		wrapped.add(
			(_next, [names]) => {
				steps.push(`observe:${names.join(',')}`)
			},
			(next, [names]) => {
				steps.push('transform')
				next([[...names, 'other']])
			},
		)

		const result = wrapped(['zhong666'])
		expect(result).toBe('zhong666,other')
		expect(steps).toEqual([
			'observe:zhong666',
			'transform',
			'fn:zhong666,other',
		])
	})

	it('allows middleware to short-circuit the chain', () => {
		const validateNames = middiefy((names: string[]): ValidationResult => {
			return {
				ok: true,
				value: names,
			}
		})

		validateNames.add(
			(next, [names]) => {
				const normalizedNames = names.map(name => name.trim())
				if (normalizedNames.some(name => name.length === 0)) {
					return {
						ok: false,
						errors: ['blank names are not allowed'],
					}
				}
				return next([normalizedNames])
			},
		)

		expect(validateNames([' zhong666 '])).toEqual({
			ok: true,
			value: ['zhong666'],
		})
		expect(validateNames(['', 'zhong666'])).toEqual({
			ok: false,
			errors: ['blank names are not allowed'],
		})
	})

	it('re-executes downstream when next is called multiple times', () => {
		const base = vi.fn<(names: string[]) => { names: string[] }>((names) => {
			return { names }
		})
		const wrapped = middiefy(base)

		wrapped.add(
			(next, [names]) => {
				const firstResult = next([[...names, 'first']])
				const secondResult = next([[...names, 'second']])
				expect(secondResult).not.toBe(firstResult)
				return firstResult
			},
		)

		expect(wrapped(['zhong666'])).toEqual({
			names: ['zhong666', 'first'],
		})
		expect(base).toHaveBeenCalledTimes(2)
		expect(base).toHaveBeenNthCalledWith(1, ['zhong666', 'first'])
		expect(base).toHaveBeenNthCalledWith(2, ['zhong666', 'second'])
	})

	it('rethrows downstream sync errors on every next call', () => {
		const syncError1 = new Error('sync boom 1')
		const syncError2 = new Error('sync boom 2')
		const base = vi.fn<(value: number) => number>((value) => {
			throw value === 1 ? syncError1 : syncError2
		})
		const wrapped = middiefy(base)

		wrapped.add(
			(next, [value]) => {
				let firstCaught: unknown
				let secondCaught: unknown

				try {
					next([value])
				}
				catch (caught) {
					firstCaught = caught
				}

				try {
					next([value + 1])
				}
				catch (caught) {
					secondCaught = caught
				}

				expect(firstCaught).toBe(syncError1)
				expect(secondCaught).toBe(syncError2)
				return 42
			},
		)

		expect(wrapped(1)).toBe(42)
		expect(base).toHaveBeenCalledTimes(2)
		expect(base).toHaveBeenNthCalledWith(1, 1)
		expect(base).toHaveBeenNthCalledWith(2, 2)
	})

	it('creates a fresh rejected promise on every next call', async () => {
		const firstError = new Error('async boom 1')
		const secondError = new Error('async boom 2')
		const base = vi.fn<(value: number) => Promise<number>>(async (value) => {
			throw value === 1 ? firstError : secondError
		})
		const wrapped = middiefy(base)

		wrapped.add(
			(next, [value]) => {
				const firstResult = next([value])
				const secondResult = next([value + 1])
				expect(secondResult).not.toBe(firstResult)
				return firstResult.catch((caught) => {
					expect(caught).toBe(firstError)
					return 24
				})
			},
		)

		await expect(wrapped(1)).resolves.toBe(24)
		await expect(base.mock.results[1]?.value).rejects.toBe(secondError)
		expect(base).toHaveBeenCalledTimes(2)
		expect(base).toHaveBeenNthCalledWith(1, 1)
		expect(base).toHaveBeenNthCalledWith(2, 2)
	})

	it('isolates async next execution across concurrent calls', async () => {
		const resolvers = new Map<number, (value: number) => void>()
		const base = vi.fn<(value: number) => Promise<number>>((value) => {
			return new Promise<number>((resolve) => {
				resolvers.set(value, resolve)
			})
		})
		const wrapped = middiefy(base)
		const seen: Promise<number>[] = []

		wrapped.add(
			async (next, [value]) => {
				const first = next([value])
				const second = next([value + 100])
				expect(second).not.toBe(first)
				seen.push(first, second)
				return await first
			},
		)

		const firstCall = wrapped(1)
		const secondCall = wrapped(2)

		expect(base).toHaveBeenCalledTimes(4)
		expect(base).toHaveBeenNthCalledWith(1, 1)
		expect(base).toHaveBeenNthCalledWith(2, 101)
		expect(base).toHaveBeenNthCalledWith(3, 2)
		expect(base).toHaveBeenNthCalledWith(4, 102)
		expect(seen).toHaveLength(4)
		expect(seen[0]).not.toBe(seen[1])
		expect(seen[2]).not.toBe(seen[3])

		resolvers.get(1)?.(2)
		resolvers.get(101)?.(202)
		resolvers.get(2)?.(4)
		resolvers.get(102)?.(204)

		await expect(firstCall).resolves.toBe(2)
		await expect(secondCall).resolves.toBe(4)
	})

	it('stops calling remaining middleware and fn after an earlier middleware throws', () => {
		const error = new Error('middleware boom')
		const base = vi.fn((value: number) => value * 2)
		const wrapped = middiefy(base)
		let passThroughCalled = false

		wrapped.add(
			() => {
				throw error
			},
			(next, [value]) => {
				passThroughCalled = true
				return next([value])
			},
		)

		expect(() => wrapped(1)).toThrow(error)
		expect(passThroughCalled).toBe(false)
		expect(base).not.toHaveBeenCalled()
	})

	it('updates the pipeline after add and remove', () => {
		const wrapped = middiefy((names: string[]) => names.join(','))
		const appendOther: MiddlewareFn<SyncFn> = (next, [names]) => next([[...names, 'other']])
		const sameShapeButDifferentReference: MiddlewareFn<SyncFn> = (next, [names]) => next([[...names, 'other']])

		expect(wrapped(['zhong666'])).toBe('zhong666')

		wrapped.add(appendOther)
		expect(wrapped(['zhong666'])).toBe('zhong666,other')

		wrapped.remove(sameShapeButDifferentReference)
		expect(wrapped(['zhong666'])).toBe('zhong666,other')

		wrapped.remove(appendOther)
		expect(wrapped(['zhong666'])).toBe('zhong666')
	})

	it('preserves middleware instance state across wrapped calls', () => {
		let calls = 0
		const wrapped = middiefy((value: number) => value)

		wrapped.add(
			(next, [value]) => next([value + ++calls]),
		)

		expect(wrapped(1)).toBe(2)
		expect(wrapped(1)).toBe(3)
		expect(calls).toBe(2)
	})

	it('deduplicates identical middleware references', () => {
		const wrapped = middiefy((names: string[]) => names.join(','))
		const appendOther: MiddlewareFn<SyncFn> = (next, [names]) => next([[...names, 'other']])

		wrapped.add(appendOther, appendOther)

		expect(wrapped(['zhong666'])).toBe('zhong666,other')
	})

	it('supports multi-argument functions', () => {
		const wrapped = middiefy((greeting: string, names: string[]) => {
			return `${greeting} ${names.join(',')}`
		})

		wrapped.add(
			(next, [greeting, names]) => next([greeting.toUpperCase(), [...names, 'other']]),
		)

		expect(wrapped('hello', ['zhong666'])).toBe('HELLO zhong666,other')
	})

	it('supports async middleware and async fallthrough', async () => {
		const steps: string[] = []
		const wrapped = middiefy(async (value: number) => {
			steps.push(`fn:${value}`)
			return value * 2
		})

		wrapped.add(
			async (next, [value]) => {
				steps.push('enter:1')
				const result = await next([value + 1])
				steps.push(`exit:1:${result}`)
				return result
			},
			async (_next, [value]) => {
				steps.push(`observe:${value}`)
				await Promise.resolve()
			},
		)

		await expect(wrapped(1)).resolves.toBe(4)
		expect(steps).toEqual([
			'enter:1',
			'observe:2',
			'fn:2',
			'exit:1:4',
		])
	})

	it('reuses the downstream promise when middleware returns next directly', async () => {
		const wrapped = middiefy(async (value: number) => value * 2)
		let downstreamPromise: Promise<number> | undefined

		wrapped.add(
			(next, [value]) => {
				downstreamPromise = next([value + 1])
				return downstreamPromise
			},
		)

		const result = wrapped(1)
		expect(result).toBe(downstreamPromise)
		await expect(result).resolves.toBe(4)
	})

	it('supports promise-like fallthrough for async middleware', async () => {
		const wrapped = middiefy(async (value: number) => value * 2)
		const thenable: PromiseLike<number | undefined> = {
			then<TResult1 = number | undefined, TResult2 = never>(
				onfulfilled?: ((value: number | undefined) => TResult1 | PromiseLike<TResult1>) | null,
				_onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
			): PromiseLike<TResult1 | TResult2> {
				if (onfulfilled == null)
					return Promise.resolve(undefined as TResult1)
				return Promise.resolve(onfulfilled(undefined))
			},
		}

		wrapped.add(
			() => thenable,
		)

		await expect(wrapped(2)).resolves.toBe(4)
	})

	it('supports callable promise-like fallthrough for async middleware', async () => {
		const wrapped = middiefy(async (value: number) => value * 2)
		const thenable = Object.assign(
			() => undefined,
			{
				then<TResult1 = number | undefined, TResult2 = never>(
					onfulfilled?: ((value: number | undefined) => TResult1 | PromiseLike<TResult1>) | null,
					_onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
				): PromiseLike<TResult1 | TResult2> {
					if (onfulfilled == null)
						return Promise.resolve(undefined as TResult1)
					return Promise.resolve(onfulfilled(undefined))
				},
			},
		)

		wrapped.add(
			() => thenable,
		)

		await expect(wrapped(2)).resolves.toBe(4)
	})

	it('supports sync middleware with promise-like fallthrough in async pipelines', async () => {
		const steps: string[] = []
		const middlewareize = middiefy(async (value: number) => {
			steps.push(`fn:${value}`)
			return value * 2
		})
		const thenable: PromiseLike<number | undefined> = {
			then<TResult1 = number | undefined, TResult2 = never>(
				onfulfilled?: ((value: number | undefined) => TResult1 | PromiseLike<TResult1>) | null,
				_onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
			): PromiseLike<TResult1 | TResult2> {
				steps.push('thenable')
				if (onfulfilled == null)
					return Promise.resolve(undefined as TResult1)
				return Promise.resolve(onfulfilled(undefined))
			},
		}

		middlewareize.add(
			(next, [value]) => {
				steps.push(`sync:${value}`)
				return next([value + 1])
			},
			(_next, [value]) => {
				steps.push(`promise-like:${value}`)
				return thenable
			},
		)

		await expect(middlewareize(1)).resolves.toBe(4)
		expect(steps).toEqual([
			'sync:1',
			'promise-like:2',
			'thenable',
			'fn:2',
		])
	})
})

type SyncFn = (name: string[]) => string
type ValidationResult
	= | { ok: true, value: string[] }
		| { ok: false, errors: string[] }
