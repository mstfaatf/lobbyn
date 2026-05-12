import { randomUUID } from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { signAccessToken, signRefreshToken, type JwtPayload } from "../../auth/jwt.js";
import { verifyPassword } from "../../auth/password.js";
import { db } from "../../db/client.js";
import {
  userBuildingMemberships,
  users,
} from "../../db/schema/users.js";
import { redis } from "../../redis/client.js";

/** Argon2id hash of `__login_dummy__` (same params as `hashPassword`) — used when no user exists so `verifyPassword` always runs. */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$nFZxiXBaC/23flkbWQI+TQ$yIv/q1NBHwy0ulYo+YygiEV3Ags3EcpKP7FbXT1n6OY";

const REFRESH_TOKEN_TTL_SECONDS = 2_592_000;

const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

function toJwtRole(role: string): JwtPayload["role"] {
  if (role === "manager" || role === "org_admin") {
    return role;
  }
  return "resident";
}

const loginAuthRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    max: 10,
    timeWindow: "15 minutes",
  });

  fastify.post("/v1/auth/login", async (request, reply) => {
    try {
      const parsed = loginBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const { email, password } = parsed.data;

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          passwordHash: users.passwordHash,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      const passwordMatches = await verifyPassword(
        password,
        user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      );

      if (!user || !passwordMatches) {
        return reply.status(401).send({
          message: "Invalid email or password",
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
      const responseRole = membership?.role ?? "resident";

      const tokenPayload = {
        sub: user.id,
        email: user.email,
        orgId,
        buildingId,
        role: jwtRole,
      };

      const tokenId = randomUUID();
      const [accessToken, refreshToken] = await Promise.all([
        signAccessToken(tokenPayload),
        signRefreshToken(tokenPayload, { jti: tokenId }),
      ]);

      const redisKey = `refresh:${user.id}:${tokenId}`;
      await redis.set(
        redisKey,
        JSON.stringify({ token: refreshToken, userId: user.id }),
        { ex: REFRESH_TOKEN_TTL_SECONDS },
      );

      return reply.status(200).send({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: responseRole,
          buildingId,
          orgId,
        },
      });
    } catch (err) {
      fastify.log.error({ err }, "login failed");
      return reply.status(500).send({ message: "Login failed" });
    }
  });
};

export default loginAuthRoutes;
