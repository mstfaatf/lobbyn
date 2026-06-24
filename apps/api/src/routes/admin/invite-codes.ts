import crypto from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { auditLogs, buildingInviteCodes } from '../../db/schema/system.js';
import { createError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const createBodySchema = z.object({
  expiresInDays: z.number().int().min(1).max(90).default(30),
});

const inviteCodesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('manager', 'org_admin'));

  fastify.post('/', async (request, reply) => {
    if (!request.user.buildingId) {
      return createError(reply, 403, 'You must be assigned to a building');
    }

    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ errors: parsed.error.flatten() });
    }

    const { expiresInDays } = parsed.data;
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const [row] = await db
      .insert(buildingInviteCodes)
      .values({
        buildingId: request.user.buildingId,
        orgId: request.user.orgId,
        createdBy: request.user.id,
        code,
        isActive: true,
        expiresAt,
      })
      .returning();

    if (row === undefined) {
      return createError(reply, 500, 'Failed to create invite code');
    }

    await db.insert(auditLogs).values({
      orgId: request.user.orgId,
      buildingId: request.user.buildingId,
      userId: request.user.id,
      action: 'invite_code.create',
      resourceType: 'building_invite_code',
      resourceId: row.id,
    });

    return reply.status(201).send({
      id: row.id,
      code: row.code,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    });
  });

  fastify.get('/', async (request, reply) => {
    if (!request.user.buildingId) {
      return createError(reply, 403, 'You must be assigned to a building');
    }

    const codes = await db
      .select({
        id: buildingInviteCodes.id,
        code: buildingInviteCodes.code,
        expiresAt: buildingInviteCodes.expiresAt,
        createdAt: buildingInviteCodes.createdAt,
        usedAt: buildingInviteCodes.usedAt,
        usedBy: buildingInviteCodes.usedBy,
      })
      .from(buildingInviteCodes)
      .where(
        and(
          eq(buildingInviteCodes.buildingId, request.user.buildingId),
          eq(buildingInviteCodes.isActive, true),
          gt(buildingInviteCodes.expiresAt, sql`now()`),
        ),
      );

    return reply.send({ codes });
  });

  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    if (!request.user.buildingId) {
      return createError(reply, 403, 'You must be assigned to a building');
    }

    const [existing] = await db
      .select({ id: buildingInviteCodes.id })
      .from(buildingInviteCodes)
      .where(
        and(
          eq(buildingInviteCodes.id, request.params.id),
          eq(buildingInviteCodes.buildingId, request.user.buildingId),
        ),
      )
      .limit(1);

    if (existing === undefined) {
      return createError(reply, 404, 'Invite code not found');
    }

    await db
      .update(buildingInviteCodes)
      .set({ isActive: false })
      .where(eq(buildingInviteCodes.id, request.params.id));

    await db.insert(auditLogs).values({
      orgId: request.user.orgId,
      buildingId: request.user.buildingId,
      userId: request.user.id,
      action: 'invite_code.revoke',
      resourceType: 'building_invite_code',
      resourceId: request.params.id,
    });

    return reply.send({ message: 'Invite code revoked' });
  });
};

export default inviteCodesRoutes;
