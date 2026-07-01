import { randomBytes } from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import { eq, ilike } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { hashPassword } from "../../auth/password.js";
import { db } from "../../db/client.js";
import { users } from "../../db/schema/users.js";
import { generateDisplayName } from "../../lib/display-name.js";
import { sendVerificationEmail } from "../../lib/email.js";

const registerBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(100),
  fullName: z.string().min(2).max(255).trim(),
});

const registerAuthRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rateLimit, {
    max: 5,
    timeWindow: "15 minutes",
  });

  fastify.post("/v1/auth/register", async (request, reply) => {
    try {
      const parsed = registerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const { email, password, fullName } = parsed.data;

      let displayName: string | undefined;
      for (let i = 0; i < 5; i++) {
        const candidate = generateDisplayName();
        const collision = await db
          .select({ id: users.id })
          .from(users)
          .where(ilike(users.displayName, candidate))
          .limit(1);
        if (collision.length === 0) {
          displayName = candidate;
          break;
        }
      }
      if (displayName === undefined) {
        displayName =
          generateDisplayName() +
          Math.floor(1000 + Math.random() * 9000).toString();
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing.length > 0) {
        return reply.status(409).send({
          message: "An account with this email already exists",
        });
      }

      const passwordHash = await hashPassword(password);

      const [inserted] = await db
        .insert(users)
        .values({
          email,
          passwordHash,
          fullName,
          displayName,
        })
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          createdAt: users.createdAt,
        });

      if (inserted === undefined) {
        throw new Error("Insert returned no row");
      }

      const verifyToken = randomBytes(32).toString("hex");
      const verifyTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db
        .update(users)
        .set({
          emailVerifyToken: verifyToken,
          emailVerifyTokenExpiresAt: verifyTokenExpiresAt,
        })
        .where(eq(users.id, inserted.id));

      try {
        await sendVerificationEmail({
          to: inserted.email,
          displayName: fullName,
          verifyUrl: `${process.env.API_BASE_URL}/v1/auth/verify-email?token=${verifyToken}&userId=${inserted.id}`,
        });
      } catch (emailErr) {
        fastify.log.error({ err: emailErr }, "Failed to send verification email after registration");
      }

      return reply.status(201).send({
        message: "Account created successfully",
        user: {
          id: inserted.id,
          email: inserted.email,
          fullName: inserted.fullName,
          createdAt: inserted.createdAt.toISOString(),
        },
      });
    } catch (err) {
      fastify.log.error({ err }, "register failed");
      return reply.status(500).send({ message: "Registration failed" });
    }
  });
};

export default registerAuthRoutes;
