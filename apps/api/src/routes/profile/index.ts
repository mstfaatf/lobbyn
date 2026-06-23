import { eq, ilike } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { verifyPassword } from "../../auth/password.js";
import { db } from "../../db/client.js";
import { auditLogs, userPreferences } from "../../db/schema/system.js";
import { userBuildingMemberships, users } from "../../db/schema/users.js";
import { authenticate } from "../../middleware/authenticate.js";

const DEFAULT_PREFERENCES = {
  notifyAnnouncements: true,
  notifyComments: true,
  notifyTickets: true,
  notifyMarketplace: true,
};

const patchProfileSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  avatarUrl: z.string().url().optional(),
});

const patchPreferencesSchema = z.object({
  notifyAnnouncements: z.boolean().optional(),
  notifyComments: z.boolean().optional(),
  notifyTickets: z.boolean().optional(),
  notifyMarketplace: z.boolean().optional(),
});

function formatPreferences(prefs: typeof DEFAULT_PREFERENCES) {
  return {
    notifyAnnouncements: prefs.notifyAnnouncements,
    notifyComments: prefs.notifyComments,
    notifyTickets: prefs.notifyTickets,
    notifyMarketplace: prefs.notifyMarketplace,
  };
}

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: authenticate }, async (request, reply) => {
    try {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          emailVerified: users.emailVerified,
        })
        .from(users)
        .where(eq(users.id, request.user.id))
        .limit(1);

      if (user === undefined) {
        return reply.status(404).send({ message: "User not found" });
      }

      const [prefs] = await db
        .select({
          notifyAnnouncements: userPreferences.notifyAnnouncements,
          notifyComments: userPreferences.notifyComments,
          notifyTickets: userPreferences.notifyTickets,
          notifyMarketplace: userPreferences.notifyMarketplace,
        })
        .from(userPreferences)
        .where(eq(userPreferences.userId, request.user.id))
        .limit(1);

      return reply.status(200).send({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        preferences: formatPreferences(prefs ?? DEFAULT_PREFERENCES),
      });
    } catch (err) {
      fastify.log.error({ err }, "GET /profile failed");
      return reply.status(500).send({ message: "Failed to fetch profile" });
    }
  });

  fastify.patch("/", { preHandler: authenticate }, async (request, reply) => {
    try {
      const parsed = patchProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const { displayName, avatarUrl } = parsed.data;

      if (displayName === undefined && avatarUrl === undefined) {
        return reply.status(400).send({ message: "At least one field is required" });
      }

      if (displayName !== undefined) {
        const [conflict] = await db
          .select({ id: users.id })
          .from(users)
          .where(ilike(users.displayName, displayName))
          .limit(1);

        if (conflict !== undefined && conflict.id !== request.user.id) {
          return reply.status(409).send({ message: "Display name is already taken" });
        }
      }

      const [updated] = await db
        .update(users)
        .set({
          ...(displayName !== undefined && { displayName }),
          ...(avatarUrl !== undefined && { avatarUrl }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, request.user.id))
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          emailVerified: users.emailVerified,
        });

      if (updated === undefined) {
        return reply.status(404).send({ message: "User not found" });
      }

      const [prefs] = await db
        .select({
          notifyAnnouncements: userPreferences.notifyAnnouncements,
          notifyComments: userPreferences.notifyComments,
          notifyTickets: userPreferences.notifyTickets,
          notifyMarketplace: userPreferences.notifyMarketplace,
        })
        .from(userPreferences)
        .where(eq(userPreferences.userId, request.user.id))
        .limit(1);

      return reply.status(200).send({
        id: updated.id,
        email: updated.email,
        fullName: updated.fullName,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
        emailVerified: updated.emailVerified,
        preferences: formatPreferences(prefs ?? DEFAULT_PREFERENCES),
      });
    } catch (err) {
      fastify.log.error({ err }, "PATCH /profile failed");
      return reply.status(500).send({ message: "Failed to update profile" });
    }
  });

  fastify.patch(
    "/preferences",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const parsed = patchPreferencesSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ errors: parsed.error.flatten() });
        }

        const updates = parsed.data;

        const [upserted] = await db
          .insert(userPreferences)
          .values({
            userId: request.user.id,
            ...DEFAULT_PREFERENCES,
            ...updates,
          })
          .onConflictDoUpdate({
            target: userPreferences.userId,
            set: {
              ...(updates.notifyAnnouncements !== undefined && {
                notifyAnnouncements: updates.notifyAnnouncements,
              }),
              ...(updates.notifyComments !== undefined && {
                notifyComments: updates.notifyComments,
              }),
              ...(updates.notifyTickets !== undefined && {
                notifyTickets: updates.notifyTickets,
              }),
              ...(updates.notifyMarketplace !== undefined && {
                notifyMarketplace: updates.notifyMarketplace,
              }),
              updatedAt: new Date(),
            },
          })
          .returning({
            notifyAnnouncements: userPreferences.notifyAnnouncements,
            notifyComments: userPreferences.notifyComments,
            notifyTickets: userPreferences.notifyTickets,
            notifyMarketplace: userPreferences.notifyMarketplace,
          });

        if (upserted === undefined) {
          return reply.status(500).send({ message: "Failed to update preferences" });
        }

        return reply.status(200).send(formatPreferences(upserted));
      } catch (err) {
        fastify.log.error({ err }, "PATCH /profile/preferences failed");
        return reply.status(500).send({ message: "Failed to update preferences" });
      }
    },
  );
  fastify.delete("/", { preHandler: authenticate }, async (request, reply) => {
    try {
      const parsed = z.object({ password: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, request.user.id))
        .limit(1);

      if (user === undefined) {
        return reply.status(404).send({ message: "User not found" });
      }

      const passwordMatches = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!passwordMatches) {
        return reply.status(401).send({ message: "Incorrect password" });
      }

      const now = new Date();

      await db
        .update(users)
        .set({
          deleteRequestedAt: now,
          isActive: false,
          fullName: "Deleted User",
          email: `deleted_${user.id}@lobbyn.invalid`,
          avatarUrl: null,
          displayName: null,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));

      await db
        .update(userBuildingMemberships)
        .set({ isActive: false })
        .where(eq(userBuildingMemberships.userId, user.id));

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId || null,
        userId: user.id,
        action: "account.delete",
        resourceType: "user",
        resourceId: user.id,
        ipAddress: request.ip ?? null,
      });

      return reply.status(200).send({ message: "Account deleted" });
    } catch (err) {
      fastify.log.error({ err }, "DELETE /profile failed");
      return reply.status(500).send({ message: "Failed to delete account" });
    }
  });
};

export default profileRoutes;
