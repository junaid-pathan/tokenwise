// Ambient declarations so the pure-logic test file type-checks under the
// project's tsconfig (which has no @types/node). The tests actually run under
// `tsx`, which provides the real implementations; these stubs only satisfy tsc
// during `vite build`. Kept inside gridroom/src/scene (our owned folder) so no
// shared config needs editing.
declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
}
declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
declare module "node:path" {
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
}
