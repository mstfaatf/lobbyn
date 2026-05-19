import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { db } from "../../db/client.js";
import { notifications } from "../../db/schema/index.js";
import {
  buildPaginatedResponse,
  decodeCursor,
  parsePaginationParams,
} from "../../lib/pagination.js";
import { authenticate } from "../../middleware/authenticate.js";
import deviceTokenRoutes from "./device-token.js";

const notificationIdParamSchema = z.string().uuid();

const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(deviceTokenRoutes);

  fastify.get(
    "/",
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.user.buildingId === "") {
        return reply.status(403).send({
          message: "Must be joined to a building",
        });
      }

      const { limit, cursor } = parsePaginationParams(
        request.query as Record<string, unknown>,
      );

      let cursorDecoded: ReturnType<typeof decodeCursor> = null;
      if (cursor !== undefined) {
        cursorDecoded = decodeCursor(cursor);
        if (cursorDecoded === null) {
          return reply.status(400).send({ message: "Invalid cursor" });
        }
      }

      const conditions = [
        eq(notifications.userId, request.user.id),
        eq(notifications.buildingId, request.user.buildingId),
      ];

      if (cursorDecoded !== null) {
        conditions.push(
          sql`(${notifications.createdAt}, ${notifications.id}) < (${cursorDecoded.createdAt}::timestamptz, ${cursorDecoded.id}::uuid)`,
        );
      }

      const fetchLimit = limit + 1;

      const results = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(fetchLimit);

      const page = buildPaginatedResponse(results, limit, (item) => ({
        createdAt: item.createdAt,
        id: item.id,
      }));

      return reply.send(page);
    },
  );

  fastify.patch(
    "/read-all",
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.user.buildingId === "") {
        return reply.status(403).send({
          message: "Must be joined to a building",
        });
      }

      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.userId, request.user.id),
            eq(notifications.buildingId, request.user.buildingId),
            eq(notifications.isRead, false),
          ),
        );

      return reply.status(200).send({
        message: "All notifications marked as read",
      });
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    "/:id/read",
    { preHandler: authenticate },
    async (request, reply) => {
      if (request.user.buildingId === "") {
        return reply.status(403).send({
          message: "Must be joined to a building",
        });
      }

      const idParsed = notificationIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return reply.status(400).send({ message: "Invalid notification id" });
      }
      const notificationId = idParsed.data;

      const [existing] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.userId, request.user.id),
          ),
        )
        .limit(1);

      if (existing === undefined) {
        return reply.status(404).send({ message: "Notification not found" });
      }

      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, notificationId));

      return reply.status(200).send({
        message: "Notification marked as read",
      });
    },
  );
};

export default notificationRoutes;
