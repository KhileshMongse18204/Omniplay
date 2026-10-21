// Cloudflare Pages Function: serves /ads.txt, /sitemap.xml and /robots.txt from the API on the site's own domain
// (ad networks and crawlers only read them from there). public/_routes.json limits this function to
// those three paths, so every other request stays a free static hit.
// Set API_URL (e.g. https://api.example.com) under Pages → Settings → Variables.

interface Ctx {
  request: Request;
  env: { API_URL: string };
  next: () => Promise<Response>;
}

export const onRequest = async ({ request, env, next }: Ctx): Promise<Response> => {
  const { pathname } = new URL(request.url);
  if (!['/ads.txt', '/sitemap.xml', '/robots.txt'].includes(pathname)) return next();
  // cf.cacheTtl keeps the upstream copy in Cloudflare's cache for an hour, so the API sees ~1 request/hour.
  const upstream = await fetch(`${env.API_URL}${pathname}`, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      'cache-control': upstream.ok ? 'public, max-age=3600' : 'no-store',
    },
  });
};
