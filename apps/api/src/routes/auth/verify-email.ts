import { randomBytes } from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

import { sendVerificationEmail } from "../../lib/email.js";
import { db } from "../../db/client.js";
import { users } from "../../db/schema/users.js";
import { authenticate } from "../../middleware/authenticate.js";

const verifyEmailRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    max: 3,
    timeWindow: "1 hour",
    keyGenerator: (request: FastifyRequest) =>
      request.user?.id ?? request.ip ?? "unknown",
  });

  fastify.post(
    "/v1/auth/send-verification",
    { preHandler: authenticate, config: { rateLimit: { max: 3, timeWindow: "1 hour" } } },
    async (request, reply) => {
      try {
        const [user] = await db
          .select({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            fullName: users.fullName,
            emailVerified: users.emailVerified,
          })
          .from(users)
          .where(eq(users.id, request.user.id))
          .limit(1);

        if (user === undefined) {
          return reply.status(404).send({ message: "User not found" });
        }

        if (user.emailVerified) {
          return reply.status(400).send({ message: "Email already verified" });
        }

        const token = randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db
          .update(users)
          .set({
            emailVerifyToken: token,
            emailVerifyTokenExpiresAt: expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        const verifyUrl = `${process.env.API_BASE_URL}/v1/auth/verify-email?token=${token}&userId=${user.id}`;

        await sendVerificationEmail({
          to: user.email,
          displayName: user.displayName ?? user.fullName,
          verifyUrl,
        });

        return reply.status(200).send({ message: "Verification email sent" });
      } catch (err) {
        fastify.log.error({ err }, "send-verification failed");
        return reply.status(500).send({ message: "Failed to send verification email" });
      }
    },
  );

  fastify.get(
    "/v1/auth/verify-email",
    { config: { rateLimit: false } },
    async (request, reply) => {
      try {
        const { token, userId } = request.query as Record<string, string | undefined>;

        if (!token || !userId) {
          return reply.status(400).send({ message: "Missing token or userId" });
        }

        const [user] = await db
          .select({
            id: users.id,
            emailVerifyToken: users.emailVerifyToken,
            emailVerifyTokenExpiresAt: users.emailVerifyTokenExpiresAt,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (
          user === undefined ||
          user.emailVerifyToken !== token ||
          user.emailVerifyTokenExpiresAt === null ||
          user.emailVerifyTokenExpiresAt < new Date()
        ) {
          return reply.status(400).send({ message: "Invalid or expired token" });
        }

        await db
          .update(users)
          .set({
            emailVerified: true,
            emailVerifyToken: null,
            emailVerifyTokenExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        return reply.status(200).send({ message: "Email verified successfully" });
      } catch (err) {
        fastify.log.error({ err }, "verify-email failed");
        return reply.status(500).send({ message: "Email verification failed" });
      }
    },
  );
};

export default verifyEmailRoutes;
