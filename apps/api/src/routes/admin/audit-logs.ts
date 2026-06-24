import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { db } from '../../db/client.js';
import { auditLogs } from '../../db/schema/system.js';
import { users } from '../../db/schema/users.js';
import {
  buildPaginatedResponse,
  decodeCursor,
  parsePaginationParams,
} from '../../lib/pagination.js';
import { createError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/requireRole.js';

const auditLogsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', requireRole('manager', 'org_admin'));

  fastify.get('/', async (request, reply) => {
    if (!request.user.buildingId) {
      return createError(reply, 403, 'You must be assigned to a building');
    }

    const query = request.query as Record<string, unknown>;
    const { cursor, limit } = parsePaginationParams(query);

    const actionFilter = typeof query.action === 'string' && query.action ? query.action : undefined;
    const resourceTypeFilter = typeof query.resourceType === 'string' && query.resourceType ? query.resourceType : undefined;
    const userIdFilter = typeof query.userId === 'string' && query.userId ? query.userId : undefined;

    let cursorDecoded: ReturnType<typeof decodeCursor> = null;
    if (cursor !== undefined) {
      cursorDecoded = decodeCursor(cursor);
      if (cursorDecoded === null) {
        return createError(reply, 400, 'Invalid cursor');
      }
    }

    const conditions = [eq(auditLogs.buildingId, request.user.buildingId)];

    if (actionFilter !== undefined) {
      conditions.push(eq(auditLogs.action, actionFilter));
    }
    if (resourceTypeFilter !== undefined) {
      conditions.push(eq(auditLogs.resourceType, resourceTypeFilter));
    }
    if (userIdFilter !== undefined) {
      conditions.push(eq(auditLogs.userId, userIdFilter));
    }
    if (cursorDecoded !== null) {
      conditions.push(
        lt(
          sql`(${auditLogs.createdAt}, ${auditLogs.id})`,
          sql`(${cursorDecoded.createdAt}::timestamptz, ${cursorDecoded.id}::uuid)`,
        ),
      );
    }

    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
        actorFullName: users.fullName,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit + 1);

    const items = rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      metadata: row.metadata,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
      actor:
        row.actorFullName !== null && row.actorEmail !== null
          ? { fullName: row.actorFullName, email: row.actorEmail }
          : null,
    }));

    const page = buildPaginatedResponse(items, limit, (item) => ({
      createdAt: item.createdAt,
      id: item.id,
    }));

    return reply.send(page);
  });
};

export default auditLogsRoutes;
