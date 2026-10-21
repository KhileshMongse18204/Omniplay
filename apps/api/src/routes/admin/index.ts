import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { authenticate } from '../../auth.ts';
import { analyticsRoutes } from './analytics.ts';
import { authRoutes } from './auth.ts';
import { categoryRoutes } from './categories.ts';
import { dashboardRoutes } from './dashboard.ts';
import { linkRoutes } from './links.ts';
import { reportRoutes } from './reports.ts';
import { settingsRoutes } from './settings.ts';
import { staffRoutes } from './staff.ts';

export const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Admin responses are per-user and live: never let a browser or the CDN cache them.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store');
    return payload;
  });

  await app.register(authRoutes, { prefix: '/auth' });

  // Everything else needs a valid access token (and the role named in each route's config).
  await app.register(async (secured) => {
    secured.addHook('onRequest', authenticate);
    await secured.register(dashboardRoutes);
    await secured.register(categoryRoutes);
    await secured.register(linkRoutes);
    await secured.register(reportRoutes);
    await secured.register(analyticsRoutes);
    await secured.register(settingsRoutes);
    await secured.register(staffRoutes);
  });
};
