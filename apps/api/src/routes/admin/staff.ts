import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { logActivity } from '@omniplay/core/activity';
import { randomToken, sha256 } from '@omniplay/core/crypto';
import { db } from '@omniplay/core/db';
import { env } from '@omniplay/core/env';
import { enqueue } from '@omniplay/core/queue';
import { users } from '@omniplay/core/schema';
import { getSettings } from '@omniplay/core/settings';
import { pgCode } from '../../http.ts';
import { httpError, Id } from './util.ts';

// Staff accounts (owner only): invite by email, change roles, approve or disable. An invite link also
// works as a password reset. Only the token's hash is stored, and links expire after 72 hours.

const Role = Type.Union([Type.Literal('owner'), Type.Literal('editor'), Type.Literal('moderator')]);
const INVITE_TTL_MS = 72 * 3_600_000;

async function sendInvite(email: string, token: string) {
  const url = `${env.adminOrigin}/accept-invite?token=${token}`;
  const smtpReady = Boolean((await getSettings('security')).smtp.host);
  if (smtpReady) {
    await enqueue('send-email', {
      to: email,
      subject: 'Your OmniPlay admin invite',
      text: `You've been invited to the OmniPlay admin panel.\n\nSet your password here (valid for 72 hours):\n${url}\n`,
    });
  }
  // The owner always gets the link back, so invites work before SMTP is configured.
  return { inviteUrl: url, emailed: smtpReady };
}

export const staffRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const owner = { config: { role: 'owner' as const } };

  app.get('/staff', owner, async () =>
    db.select({
      id: users.id, email: users.email, name: users.name, role: users.role, status: users.status,
      lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
    }).from(users).orderBy(asc(users.createdAt)));

  app.post('/staff/invite', {
    ...owner,
    schema: { body: Type.Object({ email: Type.String({ format: 'email', maxLength: 254 }), role: Role }, { additionalProperties: false }) },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const token = randomToken();
    await db.insert(users).values({
      email, role: req.body.role, status: 'invited', inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }).catch((err) => {
      if (pgCode(err) === '23505') throw httpError(409, 'That email already has an account; use “Re-send invite” instead');
      throw err;
    });
    void logActivity(req.user.sub, 'staff.invite', `Invited ${email} as ${req.body.role}`);
    return reply.code(201).send(await sendInvite(email, token));
  });

  // Role or status changes bump token_version, so the person's refresh token stops working right away.
  app.patch('/staff/:id', {
    ...owner,
    schema: {
      params: Id,
      body: Type.Object({
        role: Type.Optional(Role),
        status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('disabled')])),
      }, { additionalProperties: false }),
    },
  }, async (req) => {
    const id = req.params.id;
    if (id === req.user.sub) throw httpError(400, 'You cannot change your own role or status');
    if (req.body.role && req.body.role !== 'owner' || req.body.status === 'disabled') {
      const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
      if (target?.role === 'owner') {
        const [owners] = await db.select({ n: count() }).from(users).where(and(eq(users.role, 'owner'), eq(users.status, 'active'), ne(users.id, id)));
        if (!owners.n) throw httpError(400, 'Keep at least one active owner');
      }
    }
    const [u] = await db.update(users)
      .set({ ...req.body, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(and(eq(users.id, id), ne(users.status, 'invited')))
      .returning({ email: users.email });
    if (!u) throw httpError(404, 'Staff member not found (or still invited)');
    void logActivity(req.user.sub, 'staff.update', `Updated ${u.email}: ${Object.entries(req.body).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    return { ok: true };
  });

  // Fresh invite link; also how a forgotten password is reset (the old password stops working).
  app.post('/staff/:id/reinvite', { ...owner, schema: { params: Id } }, async (req) => {
    if (req.params.id === req.user.sub) throw httpError(400, 'Use another owner account to reset your own access');
    const token = randomToken();
    const [u] = await db.update(users).set({
      status: 'invited', passwordHash: null, inviteTokenHash: sha256(token),
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS), tokenVersion: sql`${users.tokenVersion} + 1`,
    }).where(eq(users.id, req.params.id)).returning({ email: users.email });
    if (!u) throw httpError(404, 'Staff member not found');
    void logActivity(req.user.sub, 'staff.reinvite', `Sent a new invite to ${u.email}`);
    return sendInvite(u.email, token);
  });
};
