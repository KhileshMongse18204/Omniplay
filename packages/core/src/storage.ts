import { AwsClient } from 'aws4fetch';
import { env } from './env.ts';

// Cloudflare R2 through aws4fetch, a ~2 KB SigV4 signer on native fetch, instead of the multi-MB AWS SDK.
// Keeps API/worker RAM low. Visitors load images from R2's public domain via Cloudflare's CDN, never from the VPS.

const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } = env.r2;
export const storageReady = Boolean(accountId && accessKeyId && secretAccessKey && bucket);
export const mediaUrl = publicUrl;

const client = storageReady ? new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }) : null;
const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
const objectUrl = (key: string) => `${endpoint}/${key.split('/').map(encodeURIComponent).join('/')}`;

function r2(): AwsClient {
  if (!client) throw new Error('R2 storage is not configured (set the R2_* variables in .env)');
  return client;
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`R2 ${what} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Content-addressed keys never change, so they're cached as immutable at the edge and in browsers. */
export async function putObject(key: string, body: Uint8Array, contentType: string, cacheControl = 'public, max-age=31536000, immutable') {
  await ok(await r2().fetch(objectUrl(key), {
    method: 'PUT', body, headers: { 'content-type': contentType, 'cache-control': cacheControl },
  }), `PUT ${key}`);
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await ok(await r2().fetch(objectUrl(key)), `GET ${key}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteObject(key: string): Promise<void> {
  const res = await r2().fetch(objectUrl(key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) await ok(res, `DELETE ${key}`);
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? '';

/** ListObjectsV2, first 1000 keys. Plenty for backup retention and admin listings. */
export async function listObjects(prefix: string): Promise<{ key: string; size: number; lastModified: string }[]> {
  const res = await ok(await r2().fetch(`${endpoint}?list-type=2&prefix=${encodeURIComponent(prefix)}`), `LIST ${prefix}`);
  const xml = await res.text();
  return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => ({
    key: tag(c, 'Key'), size: Number(tag(c, 'Size')), lastModified: tag(c, 'LastModified'),
  }));
}
