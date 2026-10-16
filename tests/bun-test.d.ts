/**
 * Minimal ambient declaration for `bun:test`.
 *
 * Why not `@types/bun`: the root `tsconfig.json` type-checks `tests/**` along
 * with the app, and `bun-types` installs its own `global` / `fetch` / timer
 * declarations that collide with react-native's. This app's runtime is Metro,
 * not Bun — Bun is only the test runner — so the test API is declared here
 * instead of dragging a second global environment into `bun run typecheck`.
 *
 * Only the surface these tests actually use is declared. Add to it as needed;
 * if `@types/bun` is ever installed, delete this file (the declarations would
 * conflict).
 */
declare module 'bun:test' {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toHaveProperty(key: string, value?: unknown): void;
    toBeInstanceOf(expected: unknown): void;
    toMatch(expected: string | RegExp): void;
    toMatchObject(expected: object): void;
    toThrow(expected?: unknown): void;
    readonly not: Matchers;
  }

  export function expect(value: unknown): Matchers;
  export function describe(label: string, body: () => void): void;
  export function it(label: string, body: () => void | Promise<void>): void;
  export function test(label: string, body: () => void | Promise<void>): void;
  export function beforeAll(body: () => void | Promise<void>): void;
  export function afterAll(body: () => void | Promise<void>): void;
  export function beforeEach(body: () => void | Promise<void>): void;
  export function afterEach(body: () => void | Promise<void>): void;
}
