import { Queue } from 'bullmq';
import { queueConnection } from './redis.ts';
import type { Settings } from './settings.ts';

// Anything slow (link checks, image encoding, imports, backups, email) is a job here, so API request
// handlers only enqueue and return. BullMQ reuses the Redis we already run, so there's no broker to host.

export const QUEUE_NAME = 'omniplay';

type None = Record<string, never>;
export type Jobs = {
  'flush-stats': None;
  trending: None;
  'link-check-batch': None;
  'link-check': { linkId: number };
  'image-process': { linkId: number; rawKey: string };
  'import-links': { format: 'csv' | 'json'; content: string; mode: 'upsert' | 'skip'; actorId: number };
  sitemap: None;
  backup: None;
  'send-email': { to: string; subject: string; text: string };
};
export type JobName = keyof Jobs;

let q: Queue | undefined;
/** Created on first use, so processes that never enqueue never open the extra connection. */
export const queue = (): Queue =>
  (q ??= new Queue(QUEUE_NAME, {
    connection: queueConnection(false),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      // Keep only recent job records so Redis memory stays flat.
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  }));

export const closeQueue = async () => { await q?.close(); };

export const enqueue = <N extends JobName>(name: N, data: Jobs[N], opts?: { jobId?: string; attempts?: number }) =>
  queue().add(name, data, opts);

/** (Re)apply cron jobs from settings. Called at worker boot and whenever automation settings are saved. */
export async function syncSchedules(a: Settings['automation']): Promise<void> {
  const q = queue();
  await q.upsertJobScheduler('flush-stats', { every: 60_000 }, { name: 'flush-stats' });
  await q.upsertJobScheduler('trending', { every: 15 * 60_000 }, { name: 'trending' });
  await q.upsertJobScheduler('sitemap', { pattern: '0 4 * * *', tz: 'UTC' }, { name: 'sitemap' });
  if (a.linkCheck.enabled) {
    await q.upsertJobScheduler('link-check-batch', { every: a.linkCheck.everyMinutes * 60_000 }, { name: 'link-check-batch' });
  } else await q.removeJobScheduler('link-check-batch');
  if (a.backups.enabled) {
    await q.upsertJobScheduler('backup', { pattern: a.backups.cron, tz: 'UTC' }, { name: 'backup' });
  } else await q.removeJobScheduler('backup');
}
