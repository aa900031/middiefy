# middiefy

> Compose onion-style middleware around any function.

[![npm version](https://img.shields.io/npm/v/middiefy?style=flat&colorA=18181B&colorB=F0DB4F)](https://npmjs.com/package/middiefy)
[![npm downloads](https://img.shields.io/npm/dm/middiefy?style=flat&colorA=18181B&colorB=F0DB4F)](https://npmjs.com/package/middiefy)
[![coverage](https://img.shields.io/codecov/c/gh/aa900031/middiefy?logo=codecov&style=flat&colorA=18181B&colorB=F0DB4F)](https://codecov.io/gh/aa900031/middiefy)
![coderabbit](https://img.shields.io/coderabbit/prs/github/aa900031/middiefy?style=flat&logo=coderabbit&logoColor=FF570A&label=CodeRabbit%20Reviews&colorA=18181B&colorB=F0DB4F)

## Features

- Function-safe: preserves the original parameters and return type.
- Sync and async: supports regular, async, and promise-like flows.
- Flexible middleware: works with direct middleware and helper wrappers.
- Control flow: supports transform, short-circuit, fallthrough, and error observation.

## Install

```bash
pnpm add middiefy
```

## Examples

### Direct middleware

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
// HELLO zhong666
```

### Helper middleware

```ts
import { middiefy, onError, transformArgs } from 'middiefy'

const greet = middiefy((greeting: string, name: string) => {
	return `${greeting} ${name}`
})

greet.add(
	transformArgs(([greeting, name]) => [greeting.toUpperCase(), name.trim()]),
	onError(([greeting, name], error) => {
		console.error('greet failed', { greeting, name, error })
	}),
)

greet('hello', ' zhong666 ')
// HELLO zhong666
```

## API

### middiefy(fn)

Returns a callable wrapper with the same parameters and return type as `fn`.

### wrapper.add(...middleware)

Registers middleware in call order and returns the same wrapper.

Middleware functions receive a `context` object with `next()`, `nextWith(...args)`, and readonly `args`.

### wrapper.remove(middleware)

Removes middleware by reference and returns the same wrapper.

### transformArgs(transform)

Transforms the full argument tuple before calling the next step.

### onBefore(callback)

Runs before downstream execution.

### onAfter(callback)

Observes the resolved result or thrown error, then preserves the original control flow.

### onError(callback)

Observes thrown or rejected errors, then rethrows them.

## Middleware rules

- `context.next()` continues with the current `context.args`.
- `context.nextWith(...args)` continues with replaced downstream arguments.
- Returning a value short-circuits the chain.
- Returning `undefined` falls through to the next step.
- `next()` (or `nextWith()`) can only be called once per middleware.
- `context` is bound to the current invocation; destructuring its methods (e.g. `const { next } = context`) is not supported. Call methods on `context` directly.
- If an earlier middleware throws, later middleware is not called.

## Performance guidance

- Prefer `context.next()` when a middleware does not change arguments.
- Only call `context.nextWith(...)` with new values when downstream really needs different arguments.
- In hot paths, avoid creating a new args tuple just to pass the same values through.

## Notes

- Middleware runs in onion order: registration order on the way in, reverse order on the way out.
- Sync, async, and promise-like fallthrough are supported.
- Calls without middleware use a direct fast path.
- The default dispatcher uses a compiled static middleware chain; the experimental indexed dispatcher was not faster for common passthrough or transform pipelines.

Run tests with:

```bash
pnpm test
```

Run benchmarks with:

```bash
pnpm bench
```
