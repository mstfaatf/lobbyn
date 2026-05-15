import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { db } from "../../db/client.js";
import { listings } from "../../db/schema/marketplace.js";
import { auditLogs } from "../../db/schema/system.js";
import { users } from "../../db/schema/users.js";
import { createError } from "../../lib/errors.js";
import { deleteObject, getObjectKey } from "../../lib/media.js";
import {
  buildPaginatedResponse,
  decodeCursor,
  parsePaginationParams,
} from "../../lib/pagination.js";
import { authenticate } from "../../middleware/authenticate.js";

const LISTING_CATEGORIES = [
  "for_sale",
  "services",
  "sublets",
  "free_items",
  "other",
] as const;

type ListingCategory = (typeof LISTING_CATEGORIES)[number];

const listingCategorySchema = z.enum(LISTING_CATEGORIES);

const createListingBodySchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().min(10).max(3000),
  category: listingCategorySchema,
  price: z.number().min(0).optional(),
  imageUrls: z.array(z.string()).max(10).optional(),
});

const patchListingBodySchema = z
  .object({
    title: z.string().min(3).max(255).optional(),
    description: z.string().min(10).max(3000).optional(),
    category: listingCategorySchema.optional(),
    price: z.number().min(0).optional(),
    imageUrls: z.array(z.string()).max(10).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const listingIdParamSchema = z.string().uuid();

const NO_BUILDING_MESSAGE =
  "You must join a building before accessing the marketplace";

function hasBuildingId(buildingId: string): boolean {
  return buildingId !== "";
}

function priceToNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapListingSummary(row: {
  id: string;
  title: string;
  description: string;
  category: string;
  price: string | null;
  imageUrls: string[] | null;
  expiresAt: Date;
  createdAt: Date;
  sellerId: string;
  sellerFullName: string;
  sellerAvatarUrl: string | null;
}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    price: priceToNumber(row.price),
    imageUrls: row.imageUrls ?? [],
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    seller: {
      id: row.sellerId,
      fullName: row.sellerFullName,
      avatarUrl: row.sellerAvatarUrl,
    },
  };
}

function mapListingDetail(row: {
  id: string;
  title: string;
  description: string;
  category: string;
  price: string | null;
  imageUrls: string[] | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  sellerId: string;
  sellerFullName: string;
  sellerAvatarUrl: string | null;
}) {
  return {
    ...mapListingSummary(row),
    updatedAt: row.updatedAt,
    isActive: row.isActive,
  };
}

function canManageListing(
  user: { id: string; role: "resident" | "manager" | "org_admin" },
  sellerId: string,
): boolean {
  return (
    user.id === sellerId ||
    user.role === "manager" ||
    user.role === "org_admin"
  );
}

const marketplaceListingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate);

  fastify.get("/listings", async (request, reply) => {
    if (!hasBuildingId(request.user.buildingId)) {
      return createError(reply, 403, NO_BUILDING_MESSAGE);
    }

    const { cursor, limit } = parsePaginationParams(
      request.query as Record<string, unknown>,
    );

    const rawCategory = (request.query as Record<string, unknown>).category;
    let category: ListingCategory | undefined;
    if (rawCategory !== undefined && rawCategory !== "") {
      const parsedCategory = listingCategorySchema.safeParse(rawCategory);
      if (!parsedCategory.success) {
        return createError(reply, 400, "Invalid category");
      }
      category = parsedCategory.data;
    }

    const rawSearch = (request.query as Record<string, unknown>).search;
    let searchTerm: string | undefined;
    if (typeof rawSearch === "string") {
      const trimmed = rawSearch.trim();
      if (trimmed.length > 0) {
        searchTerm = trimmed;
      }
    } else if (rawSearch !== undefined && rawSearch !== "") {
      return createError(reply, 400, "Invalid search");
    }

    let cursorDecoded: ReturnType<typeof decodeCursor> = null;
    if (cursor !== undefined) {
      cursorDecoded = decodeCursor(cursor);
      if (cursorDecoded === null) {
        return createError(reply, 400, "Invalid cursor");
      }
    }

    const conditions = [
      eq(listings.buildingId, request.user.buildingId),
      eq(listings.isActive, true),
      eq(listings.isDeleted, false),
      gt(listings.expiresAt, sql`now()`),
    ];

    if (category !== undefined) {
      conditions.push(eq(listings.category, category));
    }

    if (searchTerm !== undefined) {
      conditions.push(
        sql`${listings.searchVector} @@ plainto_tsquery('english', ${searchTerm})`,
      );
    }

    if (cursorDecoded !== null) {
      conditions.push(
        sql`(${listings.createdAt}, ${listings.id}) < (${cursorDecoded.createdAt}::timestamptz, ${cursorDecoded.id}::uuid)`,
      );
    }

    const fetchLimit = limit + 1;

    const rows = await db
      .select({
        id: listings.id,
        title: listings.title,
        description: listings.description,
        category: listings.category,
        price: listings.price,
        imageUrls: listings.imageUrls,
        expiresAt: listings.expiresAt,
        createdAt: listings.createdAt,
        sellerId: users.id,
        sellerFullName: users.fullName,
        sellerAvatarUrl: users.avatarUrl,
      })
      .from(listings)
      .innerJoin(users, eq(users.id, listings.sellerId))
      .where(and(...conditions))
      .orderBy(desc(listings.createdAt), desc(listings.id))
      .limit(fetchLimit);

    const items = rows.map((r) => mapListingSummary(r));
    const page = buildPaginatedResponse(items, limit, (item) => ({
      createdAt: item.createdAt,
      id: item.id,
    }));

    return reply.send(page);
  });

  fastify.post("/listings", async (request, reply) => {
    if (!hasBuildingId(request.user.buildingId)) {
      return createError(reply, 403, NO_BUILDING_MESSAGE);
    }

    const parsed = createListingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ errors: parsed.error.flatten() });
    }

    const body = parsed.data;

    const [inserted] = await db
      .insert(listings)
      .values({
        buildingId: request.user.buildingId,
        orgId: request.user.orgId,
        sellerId: request.user.id,
        title: body.title,
        description: body.description,
        category: body.category,
        price:
          body.price !== undefined ? String(body.price) : undefined,
        imageUrls: body.imageUrls,
        expiresAt: sql`now() + interval '30 days'`,
      })
      .returning();

    if (inserted === undefined) {
      fastify.log.error("insert listing returned no row");
      return createError(reply, 500, "Failed to create listing");
    }

    await db.insert(auditLogs).values({
      orgId: request.user.orgId,
      buildingId: request.user.buildingId,
      userId: request.user.id,
      action: "listing.create",
      resourceType: "listing",
      resourceId: inserted.id,
      metadata: { category: body.category },
    });

    const [seller] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, request.user.id))
      .limit(1);

    if (seller === undefined) {
      fastify.log.error({ userId: request.user.id }, "seller not found after insert");
      return createError(reply, 500, "Failed to create listing");
    }

    return reply.status(201).send(
      mapListingSummary({
        id: inserted.id,
        title: inserted.title,
        description: inserted.description,
        category: inserted.category,
        price: inserted.price,
        imageUrls: inserted.imageUrls,
        expiresAt: inserted.expiresAt,
        createdAt: inserted.createdAt,
        sellerId: seller.id,
        sellerFullName: seller.fullName,
        sellerAvatarUrl: seller.avatarUrl,
      }),
    );
  });

  fastify.get<{ Params: { id: string } }>(
    "/listings/:id",
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(reply, 403, NO_BUILDING_MESSAGE);
      }

      const idParsed = listingIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid listing id");
      }
      const listingId = idParsed.data;

      const [row] = await db
        .select({
          id: listings.id,
          title: listings.title,
          description: listings.description,
          category: listings.category,
          price: listings.price,
          imageUrls: listings.imageUrls,
          expiresAt: listings.expiresAt,
          createdAt: listings.createdAt,
          updatedAt: listings.updatedAt,
          isActive: listings.isActive,
          sellerId: users.id,
          sellerFullName: users.fullName,
          sellerAvatarUrl: users.avatarUrl,
        })
        .from(listings)
        .innerJoin(users, eq(users.id, listings.sellerId))
        .where(
          and(
            eq(listings.id, listingId),
            eq(listings.buildingId, request.user.buildingId),
            eq(listings.isDeleted, false),
          ),
        )
        .limit(1);

      if (row === undefined) {
        return createError(reply, 404, "Listing not found");
      }

      return reply.send(mapListingDetail(row));
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    "/listings/:id",
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(reply, 403, NO_BUILDING_MESSAGE);
      }

      const idParsed = listingIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid listing id");
      }
      const listingId = idParsed.data;

      const parsed = patchListingBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const body = parsed.data;
      if (
        body.title === undefined &&
        body.description === undefined &&
        body.category === undefined &&
        body.price === undefined &&
        body.imageUrls === undefined &&
        body.isActive === undefined
      ) {
        return createError(reply, 400, "No fields to update");
      }

      const [existing] = await db
        .select({
          id: listings.id,
          sellerId: listings.sellerId,
          buildingId: listings.buildingId,
        })
        .from(listings)
        .where(
          and(
            eq(listings.id, listingId),
            eq(listings.buildingId, request.user.buildingId),
            eq(listings.isDeleted, false),
          ),
        )
        .limit(1);

      if (existing === undefined) {
        return createError(reply, 404, "Listing not found");
      }

      if (!canManageListing(request.user, existing.sellerId)) {
        return createError(
          reply,
          403,
          "Only the seller or a building manager can update this listing",
        );
      }

      const [updated] = await db
        .update(listings)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.price !== undefined ? { price: String(body.price) } : {}),
          ...(body.imageUrls !== undefined ? { imageUrls: body.imageUrls } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(listings.id, listingId))
        .returning({ id: listings.id });

      if (updated === undefined) {
        return createError(reply, 404, "Listing not found");
      }

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId,
        userId: request.user.id,
        action: "listing.update",
        resourceType: "listing",
        resourceId: listingId,
        metadata: body,
      });

      const [row] = await db
        .select({
          id: listings.id,
          title: listings.title,
          description: listings.description,
          category: listings.category,
          price: listings.price,
          imageUrls: listings.imageUrls,
          expiresAt: listings.expiresAt,
          createdAt: listings.createdAt,
          updatedAt: listings.updatedAt,
          isActive: listings.isActive,
          sellerId: users.id,
          sellerFullName: users.fullName,
          sellerAvatarUrl: users.avatarUrl,
        })
        .from(listings)
        .innerJoin(users, eq(users.id, listings.sellerId))
        .where(eq(listings.id, listingId))
        .limit(1);

      if (row === undefined) {
        return createError(reply, 404, "Listing not found");
      }

      return reply.send(mapListingDetail(row));
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/listings/:id",
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(reply, 403, NO_BUILDING_MESSAGE);
      }

      const idParsed = listingIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid listing id");
      }
      const listingId = idParsed.data;

      const [existing] = await db
        .select({
          id: listings.id,
          sellerId: listings.sellerId,
        })
        .from(listings)
        .where(
          and(
            eq(listings.id, listingId),
            eq(listings.buildingId, request.user.buildingId),
            eq(listings.isDeleted, false),
          ),
        )
        .limit(1);

      if (existing === undefined) {
        return createError(reply, 404, "Listing not found");
      }

      if (!canManageListing(request.user, existing.sellerId)) {
        return createError(
          reply,
          403,
          "Only the seller or a building manager can remove this listing",
        );
      }

      const [deleted] = await db
        .update(listings)
        .set({ isDeleted: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(listings.id, listingId),
            eq(listings.buildingId, request.user.buildingId),
            eq(listings.isDeleted, false),
          ),
        )
        .returning({ id: listings.id, imageUrls: listings.imageUrls });

      if (deleted === undefined) {
        return createError(reply, 404, "Listing not found");
      }

      const imageUrls = deleted.imageUrls ?? [];
      if (imageUrls.length > 0) {
        for (const url of imageUrls) {
          await deleteObject(getObjectKey(url));
        }
      }

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId,
        userId: request.user.id,
        action: "listing.delete",
        resourceType: "listing",
        resourceId: listingId,
      });

      return reply.send({ message: "Listing removed" });
    },
  );
};

export default marketplaceListingsRoutes;
