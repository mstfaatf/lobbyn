import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { verifyRefreshToken } from "../../auth/jwt.js";
import { authenticate } from "../../middleware/authenticate.js";
import { redis } from "../../redis/client.js";

import { findMatchingRefreshRedisKey } from "./refresh.js";

const logoutBodySchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/v1/auth/logout",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const parsed = logoutBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ errors: parsed.error.flatten() });
        }

        let payload;
        try {
          payload = await verifyRefreshToken(parsed.data.refreshToken);
        } catch {
          return reply.status(401).send({ message: "Invalid refresh token" });
        }

        if (payload.sub !== request.user.id) {
          return reply.status(403).send({
            message: "Refresh token does not match session",
          });
        }

        const key = await findMatchingRefreshRedisKey(
          request.user.id,
          parsed.data.refreshToken,
        );
        if (key !== null) {
          await redis.del(key);
        }

        return reply.status(200).send({ message: "Logged out successfully" });
      } catch (err) {
        fastify.log.error({ err }, "logout failed");
        return reply.status(500).send({ message: "Logout failed" });
      }
    },
  );
};

export default logoutAuthRoutes;
