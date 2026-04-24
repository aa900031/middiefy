import type { MiddlewareFn } from '.'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { middiefy, onAfter, onBefore, onError, transformArgs } from '.'

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
			next => (names) => {
				steps.push('enter:1')
				const result = next([...names, 'first'])
				steps.push('exit:1')
				return result
			},
			next => (names) => {
				steps.push('enter:2')
				const result = next([...names, 'second'])
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
			() => (names) => {
				steps.push(`observe:${names.join(',')}`)
			},
			next => (names) => {
				steps.push('transform')
				next([...names, 'other'])
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
			next => (names) => {
				const normalizedNames = names.map(name => name.trim())
				if (normalizedNames.some(name => name.length === 0)) {
					return {
						ok: false,
						errors: ['blank names are not allowed'],
					}
				}
				return next(normalizedNames)
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

	it('reuses the cached downstream result when next is called multiple times', () => {
		const base = vi.fn<(names: string[]) => { names: string[] }>((names) => {
			return { names }
		})
		const wrapped = middiefy(base)

		wrapped.add(
			next => (names) => {
				const firstResult = next([...names, 'first'])
				const secondResult = next([...names, 'second'])
				expect(secondResult).toBe(firstResult)
				return firstResult
			},
		)

		expect(wrapped(['zhong666'])).toEqual({
			names: ['zhong666', 'first'],
		})
		expect(base).toHaveBeenCalledOnce()
		expect(base).toHaveBeenCalledWith(['zhong666', 'first'])
	})

	it('rethrows the same sync error when next is called multiple times', () => {
		const error = new Error('sync boom')
		const base = vi.fn<(value: number) => number>(() => {
			throw error
		})
		const wrapped = middiefy(base)

		wrapped.add(
			next => (value) => {
				let firstError: unknown
				let secondError: unknown

				try {
					next(value)
				}
				catch (caught) {
					firstError = caught
				}

				try {
					next(value + 1)
				}
				catch (caught) {
					secondError = caught
				}

				expect(firstError).toBe(error)
				expect(secondError).toBe(error)
				return 42
			},
		)

		expect(wrapped(1)).toBe(42)
		expect(base).toHaveBeenCalledOnce()
		expect(base).toHaveBeenCalledWith(1)
	})

	it('reuses the same rejected downstream promise when next is called multiple times', async () => {
		const error = new Error('async boom')
		const base = vi.fn<(value: number) => Promise<number>>(async () => {
			throw error
		})
		const wrapped = middiefy(base)

		wrapped.add(
			next => (value) => {
				const firstResult = next(value)
				const secondResult = next(value + 1)
				expect(secondResult).toBe(firstResult)
				return firstResult.catch((caught) => {
					expect(caught).toBe(error)
					return 24
				})
			},
		)

		await expect(wrapped(1)).resolves.toBe(24)
		expect(base).toHaveBeenCalledOnce()
		expect(base).toHaveBeenCalledWith(1)
	})

	it('stops calling remaining middleware and fn after an earlier middleware throws', () => {
		const error = new Error('middleware boom')
		const base = vi.fn((value: number) => value * 2)
		const wrapped = middiefy(base)
		let passThroughCalled = false

		wrapped.add(
			() => () => {
				throw error
			},
			next => (value) => {
				passThroughCalled = true
				return next(value)
			},
		)

		expect(() => wrapped(1)).toThrow(error)
		expect(passThroughCalled).toBe(false)
		expect(base).not.toHaveBeenCalled()
	})

	it('onError observes the specific error thrown by downstream middleware', () => {
		const base = vi.fn((value: number) => value * 2)
		const observed = vi.fn<(args: [number], error: Error) => void>()

		const error = new Error('downstream middleware boom')
		const wrapped = middiefy(base)

		wrapped.add(
			onError<(value: number) => number, Error>(observed),
			() => () => {
				throw error
			},
		)

		expect(() => wrapped(1)).toThrow(error)
		expect(observed).toHaveBeenCalledOnce()
		expect(observed).toHaveBeenCalledWith([1], error)
		expect(base).not.toHaveBeenCalled()
	})

	it('does not invoke downstream onError when an earlier middleware throws first', () => {
		const error = new Error('upstream middleware boom')
		const base = vi.fn((value: number) => value * 2)
		const wrapped = middiefy(base)
		const observed = vi.fn<(args: [number], error: Error) => void>()

		wrapped.add(
			() => () => {
				throw error
			},
			onError<(value: number) => number, Error>((args, caught) => {
				observed(args, caught)
			}),
		)

		expect(() => wrapped(1)).toThrow(error)
		expect(observed).not.toHaveBeenCalled()
		expect(base).not.toHaveBeenCalled()
	})

	it('updates the pipeline after add and remove', () => {
		const wrapped = middiefy((names: string[]) => names.join(','))
		const appendOther: MiddlewareFn<SyncFn> = next => names => next([...names, 'other'])
		const sameShapeButDifferentReference: MiddlewareFn<SyncFn> = next => names => next([...names, 'other'])

		expect(wrapped(['zhong666'])).toBe('zhong666')

		wrapped.add(appendOther)
		expect(wrapped(['zhong666'])).toBe('zhong666,other')

		wrapped.remove(sameShapeButDifferentReference)
		expect(wrapped(['zhong666'])).toBe('zhong666,other')

		wrapped.remove(appendOther)
		expect(wrapped(['zhong666'])).toBe('zhong666')
	})

	it('deduplicates identical middleware references', () => {
		const wrapped = middiefy((names: string[]) => names.join(','))
		const appendOther: MiddlewareFn<SyncFn> = next => names => next([...names, 'other'])

		wrapped.add(appendOther, appendOther)

		expect(wrapped(['zhong666'])).toBe('zhong666,other')
	})

	it('supports multi-argument functions', () => {
		const wrapped = middiefy((greeting: string, names: string[]) => {
			return `${greeting} ${names.join(',')}`
		})

		wrapped.add(
			next => (greeting, names) => next(greeting.toUpperCase(), [...names, 'other']),
		)

		expect(wrapped('hello', ['zhong666'])).toBe('HELLO zhong666,other')
	})

	it('transformArgs rewrites the entire argument tuple before dispatch', () => {
		const wrapped = middiefy((greeting: string, names: string[]) => {
			return `${greeting} ${names.join(',')}`
		})

		wrapped.add(
			transformArgs<(greeting: string, names: string[]) => string>(([greeting, names]) => [
				greeting.toUpperCase(),
				[...names, 'other'],
			]),
		)

		expect(wrapped('hello', ['zhong666'])).toBe('HELLO zhong666,other')
	})

	it('transformArgs rewrites the entire argument tuple before async dispatch', async () => {
		const wrapped = middiefy(async (greeting: string, names: string[]) => {
			return `${greeting} ${names.join(',')}`
		})

		wrapped.add(
			transformArgs<(greeting: string, names: string[]) => Promise<string>>(([greeting, names]) => [
				greeting.toUpperCase(),
				[...names, 'other'],
			]),
		)

		await expect(wrapped('hello', ['zhong666'])).resolves.toBe('HELLO zhong666,other')
	})

	it('onBefore observes arguments before downstream execution', () => {
		const steps: string[] = []
		const wrapped = middiefy((value: number) => {
			steps.push(`fn:${value}`)
			return value * 2
		})

		wrapped.add(
			onBefore<(value: number) => number>((args) => {
				steps.push(`before:${args[0]}`)
			}),
		)

		expect(wrapped(2)).toBe(4)
		expect(steps).toEqual([
			'before:2',
			'fn:2',
		])
	})

	it('onBefore observes arguments before async downstream execution', async () => {
		const steps: string[] = []
		const wrapped = middiefy(async (value: number) => {
			steps.push(`fn:${value}`)
			return value * 2
		})

		wrapped.add(
			onBefore<(value: number) => Promise<number>>((args) => {
				steps.push(`before:${args[0]}`)
			}),
		)

		await expect(wrapped(2)).resolves.toBe(4)
		expect(steps).toEqual([
			'before:2',
			'fn:2',
		])
	})

	it('onAfter observes resolved results and errors without changing flow', async () => {
		const events: string[] = []
		const success = middiefy(async (value: number) => value * 2)
		const failure = middiefy(async (value: number) => {
			throw new Error(`boom:${value}`)
		})

		success.add(
			onAfter<(value: number) => Promise<number>>((args, error, result) => {
				events.push(`success:${args[0]}:${String(error)}:${String(result)}`)
			}),
		)
		failure.add(
			onAfter<(value: number) => Promise<never>>((args, error, result) => {
				events.push(`failure:${args[0]}:${error instanceof Error ? error.message : String(error)}:${String(result)}`)
			}),
		)

		await expect(success(2)).resolves.toBe(4)
		await expect(failure(3)).rejects.toThrow('boom:3')
		expect(events).toEqual([
			'success:2:undefined:4',
			'failure:3:boom:3:undefined',
		])
	})

	it('onError observes sync and async errors and rethrows them', async () => {
		const events: string[] = []
		const syncFailure = middiefy((value: number) => {
			throw new Error(`sync:${value}`)
		})
		const asyncFailure = middiefy(async (value: number) => {
			throw new Error(`async:${value}`)
		})

		syncFailure.add(
			onError<(value: number) => never>((args, error) => {
				events.push(`sync:${args[0]}:${error instanceof Error ? error.message : String(error)}`)
			}),
		)
		asyncFailure.add(
			onError<(value: number) => Promise<never>>((args, error) => {
				events.push(`async:${args[0]}:${error instanceof Error ? error.message : String(error)}`)
			}),
		)

		expect(() => syncFailure(1)).toThrow('sync:1')
		await expect(asyncFailure(2)).rejects.toThrow('async:2')
		expect(events).toEqual([
			'sync:1:sync:1',
			'async:2:async:2',
		])
	})

	it('onError observes the specific async rejection thrown by downstream middleware', async () => {
		const error = new Error('async downstream middleware boom')
		const base = vi.fn(async (value: number) => value * 2)
		const wrapped = middiefy(base)
		const observed = vi.fn<(args: [number], error: Error) => void>()

		wrapped.add(
			onError<(value: number) => Promise<number>, Error>((args, caught) => {
				observed(args, caught)
			}),
			() => async () => {
				throw error
			},
		)

		await expect(wrapped(1)).rejects.toBe(error)
		expect(observed).toHaveBeenCalledOnce()
		expect(observed).toHaveBeenCalledWith([1], error)
		expect(base).not.toHaveBeenCalled()
	})

	it('supports async middleware and async fallthrough', async () => {
		const steps: string[] = []
		const wrapped = middiefy(async (value: number) => {
			steps.push(`fn:${value}`)
			return value * 2
		})

		wrapped.add(
			next => async (value) => {
				steps.push('enter:1')
				const result = await next(value + 1)
				steps.push(`exit:1:${result}`)
				return result
			},
			() => async (value) => {
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
			next => (value) => {
				downstreamPromise = next(value + 1)
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
			() => () => thenable,
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
			next => (value) => {
				steps.push(`sync:${value}`)
				return next(value + 1)
			},
			() => (value) => {
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
