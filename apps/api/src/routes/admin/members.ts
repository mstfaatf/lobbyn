import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { auditLogs } from '../../db/schema/system.js';
import { userBuildingMemberships, users } from '../../db/schema/users.js';
import { createError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const patchRoleBodySchema = z.object({
  role: z.enum(['resident', 'manager']),
});

const membersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('manager', 'org_admin'));

  fastify.get('/', async (request, reply) => {
    if (!request.user.buildingId) {
      return createError(reply, 403, 'You must be assigned to a building');
    }

    const rows = await db
      .select({
        id: userBuildingMemberships.id,
        userId: userBuildingMemberships.userId,
        role: userBuildingMemberships.role,
        unitNumber: userBuildingMemberships.unitNumber,
        joinedAt: userBuildingMemberships.joinedAt,
        userFullName: users.fullName,
        userEmail: users.email,
        userDisplayName: users.displayName,
        userAvatarUrl: users.avatarUrl,
      })
      .from(userBuildingMemberships)
      .innerJoin(users, eq(users.id, userBuildingMemberships.userId))
      .where(
        and(
          eq(userBuildingMemberships.buildingId, request.user.buildingId),
          eq(userBuildingMemberships.isActive, true),
          eq(users.isActive, true),
        ),
      );

    const members = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      role: row.role,
      unitNumber: row.unitNumber,
      joinedAt: row.joinedAt,
      user: {
        id: row.userId,
        fullName: row.userFullName,
        email: row.userEmail,
        displayName: row.userDisplayName,
        avatarUrl: row.userAvatarUrl,
      },
    }));

    return reply.send({ members });
  });

  fastify.patch<{ Params: { membershipId: string } }>(
    '/:membershipId/role',
    async (request, reply) => {
      if (!request.user.buildingId) {
        return createError(reply, 403, 'You must be assigned to a building');
      }

      const parsed = patchRoleBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const { role } = parsed.data;
      const { membershipId } = request.params;

      const [membership] = await db
        .select({ id: userBuildingMemberships.id, userId: userBuildingMemberships.userId })
        .from(userBuildingMemberships)
        .where(
          and(
            eq(userBuildingMemberships.id, membershipId),
            eq(userBuildingMemberships.buildingId, request.user.buildingId),
          ),
        )
        .limit(1);

      if (membership === undefined) {
        return createError(reply, 404, 'Membership not found');
      }

      if (membership.userId === request.user.id) {
        return reply.status(400).send({ message: 'Cannot change your own role' });
      }

      await db
        .update(userBuildingMemberships)
        .set({ role })
        .where(eq(userBuildingMemberships.id, membershipId));

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId,
        userId: request.user.id,
        action: 'member.role_change',
        resourceType: 'user_building_membership',
        resourceId: membershipId,
        metadata: { role },
      });

      return reply.send({ message: 'Role updated', role });
    },
  );

  fastify.delete<{ Params: { membershipId: string } }>(
    '/:membershipId',
    async (request, reply) => {
      if (!request.user.buildingId) {
        return createError(reply, 403, 'You must be assigned to a building');
      }

      const { membershipId } = request.params;

      const [membership] = await db
        .select({ id: userBuildingMemberships.id, userId: userBuildingMemberships.userId })
        .from(userBuildingMemberships)
        .where(
          and(
            eq(userBuildingMemberships.id, membershipId),
            eq(userBuildingMemberships.buildingId, request.user.buildingId),
          ),
        )
        .limit(1);

      if (membership === undefined) {
        return createError(reply, 404, 'Membership not found');
      }

      if (membership.userId === request.user.id) {
        return reply.status(400).send({ message: 'Cannot remove yourself' });
      }

      await db
        .update(userBuildingMemberships)
        .set({ isActive: false })
        .where(eq(userBuildingMemberships.id, membershipId));

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId,
        userId: request.user.id,
        action: 'member.remove',
        resourceType: 'user_building_membership',
        resourceId: membershipId,
      });

      return reply.send({ message: 'Member removed' });
    },
  );
};

export default membersRoutes;
