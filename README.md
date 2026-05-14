# middiefy

> Compose onion-style middleware around any function — sync, async, or thenable.

[![npm version](https://img.shields.io/npm/v/middiefy?style=flat&colorA=18181B&colorB=F0DB4F)](https://npmjs.com/package/middiefy)
[![npm downloads](https://img.shields.io/npm/dm/middiefy?style=flat&colorA=18181B&colorB=F0DB4F)](https://npmjs.com/package/middiefy)
[![coverage](https://img.shields.io/codecov/c/gh/aa900031/middiefy?logo=codecov&style=flat&colorA=18181B&colorB=F0DB4F)](https://codecov.io/gh/aa900031/middiefy)
![coderabbit](https://img.shields.io/coderabbit/prs/github/aa900031/middiefy?style=flat&logo=coderabbit&logoColor=FF570A&label=CodeRabbit&colorA=18181B&colorB=F0DB4F)

`middiefy` wraps any function with a pipeline of middleware that runs in onion order: each middleware can observe arguments, transform them, short-circuit the chain, or fall through to the next step. The wrapper preserves the original function's parameters and return type, and the same pipeline works for synchronous calls, async/Promise calls, and custom thenables.

## Features

- **Onion control flow** — register order on the way in, reverse on the way out, with `next()` to continue and a return value to short-circuit.
- **Function-shaped** — the wrapper has the same call signature and return type as the wrapped function.
- **Argument transforms** — call `nextWith(...args)` to rewrite downstream arguments without rebuilding the chain.
- **Tiny, dependency-free** — a single composable primitive plus a few optional helpers (`onBefore`, `onAfter`, `onError`, `transformArgs`).

## Install

```bash
pnpm add middiefy
# or
npm install middiefy
# or
yarn add middiefy
```

## Quick start

```ts
import { middiefy } from 'middiefy'

const greet = middiefy((greeting: string, name: string) => {
	return `${greeting} ${name}`
})

greet.add(
	(context) => {
		const [greeting, name] = context.args
		return context.nextWith(greeting.toUpperCase(), name.trim())
	},
	(context) => {
		const [, name] = context.args
		if (name.length === 0)
			return 'missing name'
		return context.next()
	},
)

greet('hello', ' zhong666 ')
// → 'HELLO zhong666'
```

The wrapper has the same call signature as the original function, plus `add()` and `remove()` for managing middleware.

## Usage

### Direct middleware

Each middleware receives a `context` object and decides what to do with the chain.

```ts
import { middiefy } from 'middiefy'

const validate = middiefy((value: number) => value * 2)

validate.add((context) => {
	const [value] = context.args
	if (value < 0)
		return 0 // short-circuit: skip downstream
	return context.next() // continue with the same args
})

validate(5) // → 10
validate(-3) // → 0
```

### Async pipelines

The same API works for async functions and middleware. Sync and async middleware can be freely mixed in the same chain.

```ts
const fetchUser = middiefy(async (id: string) => {
	return await db.users.get(id)
})

fetchUser.add(
	async (context) => {
		const [id] = context.args
		console.time(`fetchUser:${id}`)
		const result = await context.next()
		console.timeEnd(`fetchUser:${id}`)
		return result
	},
)
```

### Helper middleware

The optional `middiefy/helper` entry provides ready-made middleware for common patterns.

```ts
import { middiefy } from 'middiefy'
import { onBefore, onError, transformArgs } from 'middiefy/helper'

const greet = middiefy((greeting: string, name: string) => {
	return `${greeting} ${name}`
})

greet.add(
	transformArgs(([greeting, name]) => [greeting.toUpperCase(), name.trim()]),
	onBefore(([greeting, name]) => {
		console.log('about to greet', { greeting, name })
	}),
	onError(([greeting, name], error) => {
		console.error('greet failed', { greeting, name, error })
	}),
)

greet('hello', ' zhong666 ')
// → 'HELLO zhong666'
```

### Removing middleware

```ts
import type { MiddlewareFn } from 'middiefy'

const log: MiddlewareFn<typeof greet> = (context) => {
	console.log(context.args)
	return context.next()
}

greet.add(log)
greet.remove(log)
```

`add()` deduplicates by reference and `remove()` is a no-op when the middleware was never registered. Any change invalidates the cached dispatch chain — the next call rebuilds it on demand.

## API

### `middiefy(fn)`

Wraps `fn` and returns a callable with the same parameters and return type, plus:

| Member | Description |
|---|---|
| `wrapper.add(...middleware)` | Register middleware in call order. Returns the wrapper for chaining. |
| `wrapper.remove(middleware)` | Remove middleware by reference. Returns the wrapper. |

Calls without middleware go straight through to `fn` with no overhead.

### `MiddlewareContext<Fn>`

Every middleware receives a `context` bound to the current invocation:

| Member | Description |
|---|---|
| `context.args` | The current arguments tuple (readonly). |
| `context.next()` | Continue the chain with the current `context.args`. |
| `context.nextWith(...args)` | Continue the chain with replaced arguments. |

> [!IMPORTANT]
> `context` and its methods are bound to the current invocation. Destructuring (`const { next } = context`) is not supported — always call methods on `context` directly.

### `middiefy/helper`

Optional middleware factories for common patterns. They live in a separate entry to keep the core import minimal.

| Helper | Description |
|---|---|
| `onBefore(callback)` | Runs `callback(args)` before downstream execution. |
| `onAfter(callback)` | Observes the resolved result or thrown error, then preserves the original control flow. |
| `onError(callback)` | Observes thrown or rejected errors, then rethrows them. |
| `transformArgs(transform)` | Rewrites the full argument tuple before calling the next step. |

## Middleware rules

- Returning a value **short-circuits** the chain — downstream and `fn` are not called.
- Returning `undefined` **falls through** — if `next()` / `nextWith()` was not called yet, the chain continues automatically.
- `next()` / `nextWith()` can only be called once per middleware invocation. A second call throws.
- If an earlier middleware throws, later middleware and `fn` are not called. Errors propagate to the caller.
- Async fallthrough works the same way: returning a Promise (or thenable) that resolves to `undefined` falls through to the next step.

## Performance

`middiefy` is designed to have low per-call overhead:

- The dispatch chain is **compiled lazily** the first time `wrapper()` is invoked, then cached until `add()` or `remove()` changes it.
- Calls with **zero middleware** bypass the chain entirely and call `fn` directly.
- The hot path avoids unnecessary allocations and uses a fast Promise check (`instanceof Promise` first, thenable fallback) to keep sync paths free of async-detection overhead.

> [!TIP]
> Prefer `context.next()` over `context.nextWith(...context.args)`. The former is allocation-free; the latter rebuilds the arguments tuple on every call.

Run the bench suite locally:

```bash
pnpm bench
```

Every commit is also tracked on [CodSpeed](https://codspeed.io/aa900031/middiefy), so regressions surface directly on pull requests.

## Development

```bash
pnpm install
pnpm test       # run unit tests
pnpm typecheck  # verify types
pnpm bench      # run benchmarks
pnpm build      # build dist/
```
