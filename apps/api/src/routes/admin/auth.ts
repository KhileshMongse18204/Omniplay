import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply } from 'fastify';
import { and, eq, gt, sql } from 'drizzle-orm';
import { logActivity } from '@omniplay/core/activity';
import { hashPassword, sha256, verifyPassword } from '@omniplay/core/crypto';
import { db } from '@omniplay/core/db';
import { env } from '@omniplay/core/env';
import { users } from '@omniplay/core/schema';
import { getSettings } from '@omniplay/core/settings';
import { ACCESS_TTL, REFRESH_TTL_S, type Role } from '../../auth.ts';
import { pgCode } from '../../http.ts';

// Login, refresh, logout, invites and optional staff sign-up.
// The access token (15 min) lives in the admin app's memory. The refresh token is an httpOnly, SameSite=Strict
// cookie scoped to /admin/auth, so page scripts can never read it and no other route ever receives it.

const COOKIE = 'omni_rt';
const cookieOpts = { path: '/admin/auth', httpOnly: true, secure: env.isProd, sameSite: 'strict' as const, maxAge: REFRESH_TTL_S };
const Password = Type.String({ minLength: 10, maxLength: 200 });

// Unknown emails still pay for a real scrypt check, so response time doesn't reveal which accounts exist.
let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword('omniplay-timing-equaliser'));

const profile = { id: users.id, email: users.email, name: users.name, role: users.role, status: users.status, tokenVersion: users.tokenVersion };
type Profile = { id: number; email: string; name: string; role: Role; tokenVersion: number };

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const session = (reply: FastifyReply, u: Profile) => {
    reply.setCookie(COOKIE, app.jwt.sign({ sub: u.id, tv: u.tokenVersion, typ: 'refresh' }, { expiresIn: '7d' }), cookieOpts);
    return {
      accessToken: app.jwt.sign({ sub: u.id, role: u.role, typ: 'access' }, { expiresIn: ACCESS_TTL }),
      user: { id: u.id, email: u.email, name: u.name, role: u.role },
    };
  };

  app.get('/config', async () => ({ openSignup: (await getSettings('security')).registration.openSignup }));

  app.post('/login', {
    config: { rateLimit: { max: async () => (await getSettings('security')).rateLimits.loginPer15Min, timeWindow: 15 * 60_000 } },
    schema: { body: Type.Object({ email: Type.String({ maxLength: 254 }), password: Type.String({ maxLength: 200 }) }) },
  }, async (req, reply) => {
    const [u] = await db.select({ ...profile, passwordHash: users.passwordHash }).from(users)
      .where(eq(users.email, req.body.email.trim().toLowerCase()));
    const ok = await verifyPassword(req.body.password, u?.passwordHash ?? await dummyHash());
    if (!u || !ok) return reply.code(401).send({ error: 'Wrong email or password' });
    if (u.status !== 'active') {
      return reply.code(403).send({ error: u.status === 'pending' ? 'Your account is waiting for owner approval' : 'This account is disabled' });
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
    return session(reply, u);
  });

  // The only stateful check: is the user still active, and is the token version current?
  // It runs once per 15 minutes per admin, never per request.
  app.post('/refresh', async (req, reply) => {
    try {
      const p = app.jwt.verify<{ sub: number; tv: number; typ: string }>(req.cookies[COOKIE] ?? '');
      if (p.typ === 'refresh') {
        const [u] = await db.select(profile).from(users).where(eq(users.id, p.sub));
        if (u && u.status === 'active' && u.tokenVersion === p.tv) return session(reply, u);
      }
    } catch { /* fall through to 401 */ }
    reply.clearCookie(COOKIE, { path: cookieOpts.path });
    return reply.code(401).send({ error: 'Session expired' });
  });

  // Bumping token_version revokes every refresh token this user holds ("log out everywhere").
  app.post('/logout', async (req, reply) => {
    try {
      const p = app.jwt.verify<{ sub: number; typ: string }>(req.cookies[COOKIE] ?? '');
      if (p.typ === 'refresh') await db.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, p.sub));
    } catch { /* already logged out */ }
    reply.clearCookie(COOKIE, { path: cookieOpts.path });
    return reply.code(204).send();
  });

  app.post('/accept-invite', {
    config: { rateLimit: { max: 10, timeWindow: 15 * 60_000 } },
    schema: { body: Type.Object({ token: Type.String({ minLength: 20, maxLength: 100 }), name: Type.String({ minLength: 1, maxLength: 80 }), password: Password }) },
  }, async (req, reply) => {
    const [u] = await db.update(users)
      .set({ passwordHash: await hashPassword(req.body.password), name: req.body.name.trim(), status: 'active', inviteTokenHash: null, inviteExpiresAt: null })
      .where(and(eq(users.inviteTokenHash, sha256(req.body.token)), eq(users.status, 'invited'), gt(users.inviteExpiresAt, new Date())))
      .returning({ id: users.id, email: users.email });
    if (!u) return reply.code(400).send({ error: 'This invite link is invalid or has expired' });
    void logActivity(u.id, 'staff.joined', `${u.email} accepted their invite`);
    return reply.code(204).send();
  });

  // Staff self-sign-up: only when the owner has opened it under Settings → Security → Registration rules.
  app.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: 60 * 60_000 } },
    schema: { body: Type.Object({ email: Type.String({ format: 'email', maxLength: 254 }), name: Type.String({ minLength: 1, maxLength: 80 }), password: Password }) },
  }, async (req, reply) => {
    const rules = (await getSettings('security')).registration;
    if (!rules.openSignup) return reply.code(403).send({ error: 'Staff sign-up is closed. Ask the owner for an invite.' });
    const email = req.body.email.trim().toLowerCase();
    const domains = rules.allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    if (domains.length && !domains.includes(email.split('@')[1])) {
      return reply.code(403).send({ error: 'Sign-up is limited to approved email domains' });
    }
    const status = rules.requireApproval ? 'pending' : 'active';
    try {
      await db.insert(users).values({ email, name: req.body.name.trim(), passwordHash: await hashPassword(req.body.password), role: rules.defaultRole, status });
    } catch (err) {
      if (pgCode(err) === '23505') return reply.code(409).send({ error: 'An account with this email already exists' });
      throw err;
    }
    void logActivity(null, 'staff.signup', `${email} signed up${status === 'pending' ? ' and is waiting for approval' : ''}`);
    return reply.code(201).send({ status });
  });
};
