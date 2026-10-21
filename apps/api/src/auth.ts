import type { FastifyReply, FastifyRequest } from 'fastify';

// Stateless admin auth. Each request is checked by verifying a 15-minute access JWT's signature:
// no session store, no DB or Redis lookup. Revocation happens at refresh time (users.token_version).

export type Role = 'owner' | 'editor' | 'moderator';
const rank: Record<Role, number> = { moderator: 1, editor: 2, owner: 3 };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number; typ: 'access' | 'refresh'; role?: Role; tv?: number };
    user: { sub: number; typ: 'access' | 'refresh'; role: Role; tv?: number };
  }
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Minimum staff role for an admin route (default: moderator). */
    role?: Role;
  }
}

export const ACCESS_TTL = '15m';
export const REFRESH_TTL_S = 7 * 86_400;

/** onRequest guard for protected admin routes; runs before body parsing, so rejected requests are cheap. */
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  if (req.user.typ !== 'access') return reply.code(401).send({ error: 'Unauthorized' });
  const min = req.routeOptions.config.role ?? 'moderator';
  if (rank[req.user.role] < rank[min]) return reply.code(403).send({ error: `Requires the ${min} role` });
}

export const atLeast = (role: Role, min: Role) => rank[role] >= rank[min];
