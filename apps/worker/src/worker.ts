// OmniPlay background worker: everything slow or scheduled runs here, so the API never blocks on it.
import { Worker, type Job } from 'bullmq';
import { pg } from '@omniplay/core/db';
import { assertEnv } from '@omniplay/core/env';
import { QUEUE_NAME, closeQueue, syncSchedules, type JobName, type Jobs } from '@omniplay/core/queue';
import { K, queueConnection, redis } from '@omniplay/core/redis';
import { getSettings } from '@omniplay/core/settings';
import { importLinks } from './import.ts';
import { processImage } from './image.ts';
import { checkLinks } from './link-check.ts';
import { backupDatabase, buildSitemap, sendEmail } from './maintenance.ts';
import { flushStats, updateTrending } from './stats.ts';

assertEnv(['DATABASE_URL', 'SECRETS_KEY']);

const handlers: { [N in JobName]: (job: Job<Jobs[N]>) => Promise<unknown> } = {
  'flush-stats': () => flushStats(),
  trending: () => updateTrending(),
  'link-check-batch': () => checkLinks(),
  'link-check': (job) => checkLinks(job.data.linkId),
  'image-process': (job) => processImage(job.data.linkId, job.data.rawKey),
  'import-links': async (job) => {
    const { format, content, mode, actorId } = job.data;
    await job.updateData({ ...job.data, content: '' }); // drop the (up to 2.5 MB) payload from Redis immediately
    return importLinks(format, content, mode, actorId);
  },
  sitemap: () => buildSitemap(),
  backup: () => backupDatabase(),
  'send-email': (job) => sendEmail(job.data.to, job.data.subject, job.data.text),
};

// Records when each recurring job last ran; the dashboard's "system health" panel reads these.
const tracked: Partial<Record<JobName, string>> = {
  'flush-stats': 'flush-stats', 'link-check-batch': 'link-check', sitemap: 'sitemap', backup: 'backup',
};

// Concurrency 4: most jobs wait on network/DB, so a few in parallel use the CPU well without
// competing with the API. Image encoding is single-threaded inside sharp anyway.
const worker = new Worker(QUEUE_NAME, async (job: Job) => {
  const result = await handlers[job.name as JobName](job as never);
  const name = tracked[job.name as JobName];
  if (name) await redis.set(K.lastRun(name), JSON.stringify({ at: new Date().toISOString(), ...(result as object) }));
  return result;
}, { connection: queueConnection(true), concurrency: 4 });

worker.on('failed', (job, err) => console.error(`[worker] ${job?.name} #${job?.id} failed: ${err.message}`));
worker.on('error', (err) => console.error('[worker] error', err.message));

await syncSchedules(await getSettings('automation'));
console.log('[worker] ready');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await worker.close(); // finish in-flight jobs first
    await Promise.allSettled([closeQueue(), pg.end({ timeout: 5 }), redis.quit()]);
    process.exit(0);
  });
}
