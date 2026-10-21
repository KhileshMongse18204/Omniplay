import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAlive, nextState } from './health.ts';

test('isAlive treats bot walls as up and 404/5xx/network errors as down', () => {
  for (const code of [200, 301, 401, 403, 429]) assert.equal(isAlive(code), true, String(code));
  for (const code of [0, 404, 410, 500, 502, 503]) assert.equal(isAlive(code), false, String(code));
});

test('nextState flags after the threshold and only auto-restores its own flags', () => {
  const active = { status: 'active' as const, checkFailures: 1, autoBroken: false };
  assert.deepEqual(nextState(active, 404, 3), { failures: 2, status: 'active', autoBroken: false });
  assert.deepEqual(nextState({ ...active, checkFailures: 2 }, 0, 3), { failures: 3, status: 'broken', autoBroken: true });
  assert.deepEqual(nextState({ ...active, status: 'broken', autoBroken: true }, 200, 3), { failures: 0, status: 'active', autoBroken: false });
  // An admin marked it broken by hand: a successful check must not undo that.
  assert.deepEqual(nextState({ ...active, status: 'broken', autoBroken: false }, 200, 3), { failures: 0, status: 'broken', autoBroken: false });
});
