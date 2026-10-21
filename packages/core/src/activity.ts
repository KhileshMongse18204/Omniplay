import { db } from './db.ts';
import { activityLog } from './schema.ts';

/** Append to the dashboard activity feed. Best effort: it never throws, so callers needn't await it. */
export const logActivity = (actorId: number | null, action: string, summary: string): Promise<void> =>
  db.insert(activityLog).values({ actorId, action, summary: summary.slice(0, 300) }).then(() => undefined, () => undefined);
