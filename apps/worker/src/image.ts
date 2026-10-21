import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { clearCache } from '@omniplay/core/cache';
import { db } from '@omniplay/core/db';
import { IMAGE_WIDTHS } from '@omniplay/core/links';
import { links } from '@omniplay/core/schema';
import { deleteObject, getObject, putObject } from '@omniplay/core/storage';

// Thumbnail/favicon pipeline: raw upload → AVIF + WebP at every srcset width → R2 (immutable, edge-cached).
// One libvips thread and no libvips cache, so a big upload can't starve the API on a 2-vCPU box.
sharp.concurrency(1);
sharp.cache(false);

export async function processImage(linkId: number, rawKey: string): Promise<{ imageKey: string }> {
  const raw = await getObject(rawKey);
  // Content-addressed key: re-uploading the same file reuses URLs, and new files never collide with cached ones.
  const imageKey = `img/${createHash('sha256').update(raw).digest('hex').slice(0, 20)}`;
  const source = sharp(raw, { animated: false, limitInputPixels: 40_000_000 }).rotate(); // honour EXIF orientation

  for (const width of IMAGE_WIDTHS) {
    const resized = source.clone().resize({ width, withoutEnlargement: true });
    const [avif, webp] = await Promise.all([
      resized.clone().avif({ quality: 50, effort: 4 }).toBuffer(),
      resized.clone().webp({ quality: 74, effort: 4 }).toBuffer(),
    ]);
    await Promise.all([
      putObject(`${imageKey}-${width}.avif`, avif, 'image/avif'),
      putObject(`${imageKey}-${width}.webp`, webp, 'image/webp'),
    ]);
  }

  await db.update(links).set({ imageKey, updatedAt: new Date() }).where(eq(links.id, linkId));
  await Promise.all([deleteObject(rawKey), clearCache()]);
  return { imageKey };
}
