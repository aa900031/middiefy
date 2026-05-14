import { describe, expect, it, vi } from 'vitest'
import { middiefy } from '.'
import { onAfter, onBefore, onError, transformArgs } from './helper'

describe('onError', () => {
	it('onError observes the specific error thrown by downstream middleware', () => {
		const base = vi.fn((value: number) => value * 2)
		const observed = vi.fn<(args: [number], error: Error) => void>()

		const error = new Error('downstream middleware boom')
		const wrapped = middiefy(base)

		wrapped.add(
			onError<(value: number) => number, Error>(observed),
			() => {
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
			() => {
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
			async () => {
				throw error
			},
		)

		await expect(wrapped(1)).rejects.toBe(error)
		expect(observed).toHaveBeenCalledOnce()
		expect(observed).toHaveBeenCalledWith([1], error)
		expect(base).not.toHaveBeenCalled()
	})

	it('onError does nothing on sync success', () => {
		const base = vi.fn((value: number) => value * 2)
		const wrapped = middiefy(base)
		const observed = vi.fn<(args: [number], error: Error) => void>()

		wrapped.add(
			onError<(value: number) => number, Error>(observed),
		)

		expect(wrapped(2)).toBe(4)
		expect(observed).not.toHaveBeenCalled()
		expect(base).toHaveBeenCalledOnce()
	})
})

describe('transformArgs', () => {
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
})

describe('onBefore', () => {
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
})

describe('onAfter', () => {
	it('onAfter observes sync results and sync errors without changing flow', () => {
		const events: string[] = []
		const success = middiefy((value: number) => value * 2)
		const failure = middiefy((value: number) => {
			throw new Error(`boom:${value}`)
		})

		success.add(
			onAfter<(value: number) => number>((args, error, result) => {
				events.push(`success:${args[0]}:${String(error)}:${String(result)}`)
			}),
		)
		failure.add(
			onAfter<(value: number) => never>((args, error, result) => {
				events.push(`failure:${args[0]}:${error instanceof Error ? error.message : String(error)}:${String(result)}`)
			}),
		)

		expect(success(2)).toBe(4)
		expect(() => failure(3)).toThrow('boom:3')
		expect(events).toEqual([
			'success:2:undefined:4',
			'failure:3:boom:3:undefined',
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
})
