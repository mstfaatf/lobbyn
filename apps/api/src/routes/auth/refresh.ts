import { randomUUID } from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type JwtPayload,
} from "../../auth/jwt.js";
import { db } from "../../db/client.js";
import {
  userBuildingMemberships,
  users,
} from "../../db/schema/users.js";
import { redis } from "../../redis/client.js";

const REFRESH_TOKEN_TTL_SECONDS = 2_592_000;

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

function toJwtRole(role: string): JwtPayload["role"] {
  if (role === "manager" || role === "org_admin") {
    return role;
  }
  return "resident";
}

type StoredRefreshSession = { token: string; userId: string };

/** Scans `refresh:{userId}:*` and returns the Redis key whose stored JSON `token` matches. */
export async function findMatchingRefreshRedisKey(
  userId: string,
  refreshToken: string,
): Promise<string | null> {
  const keys = await redis.keys(`refresh:${userId}:*`);
  for (const key of keys) {
    const raw = await redis.get(key);
    if (raw === null) {
      continue;
    }
    let parsed: StoredRefreshSession;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw) as StoredRefreshSession;
      } catch {
        continue;
      }
    } else if (typeof raw === "object" && raw !== null && "token" in raw) {
      parsed = raw as StoredRefreshSession;
    } else {
      continue;
    }
    if (parsed.token === refreshToken) {
      return key;
    }
  }
  return null;
}

const refreshAuthRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    max: 20,
    timeWindow: "15 minutes",
  });

  fastify.post("/v1/auth/refresh", async (request, reply) => {
    try {
      const parsed = refreshBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const { refreshToken } = parsed.data;

      let jwtPayload: JwtPayload;
      try {
        jwtPayload = await verifyRefreshToken(refreshToken);
      } catch {
        return reply.status(401).send({ message: "Invalid refresh token" });
      }

      const userId = jwtPayload.sub;

      const redisKey = await findMatchingRefreshRedisKey(userId, refreshToken);
      if (redisKey === null) {
        return reply.status(401).send({
          message: "Refresh token has been revoked",
        });
      }

      await redis.del(redisKey);

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        return reply.status(401).send({
          message: "Refresh token has been revoked",
        });
      }

      if (!user.isActive) {
        return reply.status(403).send({ message: "Account is disabled" });
      }

      const [membership] = await db
        .select({
          orgId: userBuildingMemberships.orgId,
          buildingId: userBuildingMemberships.buildingId,
          role: userBuildingMemberships.role,
        })
        .from(userBuildingMemberships)
        .where(
          and(
            eq(userBuildingMemberships.userId, user.id),
            eq(userBuildingMemberships.isActive, true),
          ),
        )
        .limit(1);

      const orgId = membership?.orgId ?? "";
      const buildingId = membership?.buildingId ?? "";
      const jwtRole = toJwtRole(membership?.role ?? "resident");

      const tokenPayload = {
        sub: user.id,
        email: user.email,
        orgId,
        buildingId,
        role: jwtRole,
      };

      const tokenId = randomUUID();
      const [accessToken, newRefreshToken] = await Promise.all([
        signAccessToken(tokenPayload),
        signRefreshToken(tokenPayload, { jti: tokenId }),
      ]);

      await redis.set(
        `refresh:${user.id}:${tokenId}`,
        JSON.stringify({ token: newRefreshToken, userId: user.id }),
        { ex: REFRESH_TOKEN_TTL_SECONDS },
      );

      return reply.status(200).send({
        accessToken,
        refreshToken: newRefreshToken,
      });
    } catch (err) {
      fastify.log.error({ err }, "refresh failed");
      return reply.status(500).send({ message: "Refresh failed" });
    }
  });
};

export default refreshAuthRoutes;
