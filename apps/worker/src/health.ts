// Pure link-health rules (no I/O), kept apart from link-check.ts so they can be unit-tested without a DB.
// Perf: decisions are computed in memory, so a whole batch is written back with one bulk UPDATE.

/** HTTP status → "is the site up?". Bot walls (401/403/429, Cloudflare challenges) are not dead sites. */
export const isAlive = (code: number) => code > 0 && (code < 400 || [401, 403, 405, 406, 429, 451].includes(code));

type Checked = { status: 'active' | 'draft' | 'hidden' | 'broken'; checkFailures: number; autoBroken: boolean };

/** Next health state. Only the checker's own 'broken' flag auto-restores; a human's decision is never undone. */
export function nextState(l: Checked, code: number, threshold: number) {
  const alive = isAlive(code);
  const failures = alive ? 0 : Math.min(l.checkFailures + 1, 999);
  let status = l.status;
  let autoBroken = l.autoBroken;
  if (!alive && l.status === 'active' && failures >= threshold) { status = 'broken'; autoBroken = true; }
  if (alive && l.status === 'broken' && l.autoBroken) { status = 'active'; autoBroken = false; }
  return { failures, status, autoBroken };
}
