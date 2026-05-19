import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/client.js";
import { deviceTokens } from "../../db/schema/index.js";
import { authenticate } from "../../middleware/authenticate.js";

const deviceTokenBodySchema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["ios", "android"]),
});

const deviceTokenRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/device-token",
    {
      preHandler: [
        authenticate,
        fastify.rateLimit({
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (request) => request.user.id,
        }),
      ],
    },
    async (request, reply) => {
      if (request.user.buildingId === "") {
        return reply.status(403).send({
          message: "Must be joined to a building",
        });
      }

      const parsed = deviceTokenBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        });
      }

      const body = parsed.data;

      const [existing] = await db
        .select({
          id: deviceTokens.id,
          userId: deviceTokens.userId,
        })
        .from(deviceTokens)
        .where(eq(deviceTokens.token, body.token))
        .limit(1);

      if (existing !== undefined) {
        if (existing.userId === request.user.id) {
          return reply.status(200).send({ message: "Token already registered" });
        }

        await db
          .update(deviceTokens)
          .set({
            userId: request.user.id,
            buildingId: request.user.buildingId,
            orgId: request.user.orgId,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(deviceTokens.id, existing.id));

        return reply.status(200).send({ message: "Device token registered" });
      }

      await db.insert(deviceTokens).values({
        userId: request.user.id,
        buildingId: request.user.buildingId,
        orgId: request.user.orgId,
        token: body.token,
        platform: body.platform,
        isActive: true,
      });

      return reply.status(200).send({ message: "Device token registered" });
    },
  );
};

export default fp(deviceTokenRoutes);
