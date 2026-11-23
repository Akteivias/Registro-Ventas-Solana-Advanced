import assert from 'node:assert/strict';

/**
 * Asserts that an async transaction or action rejects with an error matching `codeRegex`.
 * Keeps the assertion outside `try/catch` so unexpected success cannot be swallowed.
 */
export async function expectProgramRejection(
  action: () => Promise<unknown>,
  codeRegex: RegExp,
  readLogs?: (err: unknown) => Promise<string[] | undefined> | string[] | undefined,
): Promise<void> {
  let failed = false;
  try {
    await action();
  } catch (err: unknown) {
    failed = true;
    const errObj = err as { message?: unknown; logs?: unknown };
    const message = err instanceof Error ? err.message : String(errObj?.message ?? err);
    const logs = Array.isArray(errObj?.logs) ? errObj.logs : ((await readLogs?.(err)) ?? []);
    assert.match(JSON.stringify([message, logs]), codeRegex);
  }
  assert.equal(failed, true, `Expected rejection matching ${codeRegex}, but action succeeded.`);
}
