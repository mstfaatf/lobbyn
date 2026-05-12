import rateLimit from "@fastify/rate-limit";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { hashPassword } from "../../auth/password.js";
import { db } from "../../db/client.js";
import { users } from "../../db/schema/users.js";

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
