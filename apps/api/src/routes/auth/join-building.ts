import { randomUUID } from "node:crypto";

import { and, eq, gt, ilike, isNull, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { signAccessToken, signRefreshToken } from "../../auth/jwt.js";
import { db } from "../../db/client.js";
import { buildings } from "../../db/schema/organizations.js";
import { buildingInviteCodes } from "../../db/schema/system.js";
import {
  userBuildingMemberships,
  users,
} from "../../db/schema/users.js";
import { authenticate } from "../../middleware/authenticate.js";
import { redis } from "../../redis/client.js";

const REFRESH_TOKEN_TTL_SECONDS = 2_592_000;

const joinBuildingBodySchema = z.object({
  code: z.string().trim().min(1).transform((s) => s.toUpperCase()),
});

const joinBuildingAuthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/v1/auth/join-building",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const parsed = joinBuildingBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ errors: parsed.error.flatten() });
        }

        const code = parsed.data.code;

        const [invite] = await db
          .select({
            id: buildingInviteCodes.id,
            buildingId: buildingInviteCodes.buildingId,
            orgId: buildingInviteCodes.orgId,
          })
          .from(buildingInviteCodes)
          .where(
            and(
              ilike(buildingInviteCodes.code, code),
              eq(buildingInviteCodes.isActive, true),
              isNull(buildingInviteCodes.usedAt),
              gt(buildingInviteCodes.expiresAt, sql`now()`),
            ),
          )
          .limit(1);

        if (invite === undefined) {
          return reply.status(404).send({
            message: "Invalid or expired invite code",
          });
        }

        const [existingMembership] = await db
          .select({ id: userBuildingMemberships.id })
          .from(userBuildingMemberships)
          .where(
            and(
              eq(userBuildingMemberships.userId, request.user.id),
              eq(userBuildingMemberships.buildingId, invite.buildingId),
              eq(userBuildingMemberships.isActive, true),
            ),
          )
          .limit(1);

        if (existingMembership !== undefined) {
          return reply.status(409).send({
            message: "You are already a member of this building",
          });
        }

        await db.insert(userBuildingMemberships).values({
          userId: request.user.id,
          buildingId: invite.buildingId,
          orgId: invite.orgId,
          role: "resident",
        });

        await db
          .update(buildingInviteCodes)
          .set({
            usedAt: sql`now()`,
            usedBy: request.user.id,
            isActive: false,
          })
          .where(eq(buildingInviteCodes.id, invite.id));

        const [user] = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, request.user.id))
          .limit(1);

        if (user === undefined) {
          return reply.status(500).send({ message: "Join building failed" });
        }

        const [building] = await db
          .select({
            id: buildings.id,
            name: buildings.name,
          })
          .from(buildings)
          .where(eq(buildings.id, invite.buildingId))
          .limit(1);

        if (building === undefined) {
          return reply.status(500).send({ message: "Join building failed" });
        }

        const tokenPayload = {
          sub: request.user.id,
          email: user.email,
          orgId: invite.orgId,
          buildingId: invite.buildingId,
          role: "resident" as const,
        };

        const tokenId = randomUUID();
        const [accessToken, refreshToken] = await Promise.all([
          signAccessToken(tokenPayload),
          signRefreshToken(tokenPayload, { jti: tokenId }),
        ]);

        await redis.set(
          `refresh:${request.user.id}:${tokenId}`,
          JSON.stringify({ token: refreshToken, userId: request.user.id }),
          { ex: REFRESH_TOKEN_TTL_SECONDS },
        );

        return reply.status(200).send({
          message: "Successfully joined building",
          accessToken,
          refreshToken,
          building: {
            id: building.id,
            name: building.name,
          },
        });
      } catch (err) {
        fastify.log.error({ err }, "join-building failed");
        return reply.status(500).send({ message: "Join building failed" });
      }
    },
  );
};

export default joinBuildingAuthRoutes;
