import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { db } from "../../db/client.js";
import { comments, posts, reactions } from "../../db/schema/feed.js";
import { auditLogs } from "../../db/schema/system.js";
import { users } from "../../db/schema/users.js";
import { createError } from "../../lib/errors.js";
import {
  buildPaginatedResponse,
  decodeCursor,
  parsePaginationParams,
} from "../../lib/pagination.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/requireRole.js";

const FEED_CATEGORIES = [
  "announcement",
  "general",
  "event",
  "lost_and_found",
  "question",
] as const;

type FeedPostCategory = (typeof FEED_CATEGORIES)[number];

const feedPostCategorySchema = z.enum(FEED_CATEGORIES);

const createPostBodySchema = z.object({
  category: feedPostCategorySchema,
  title: z.string().max(255).optional(),
  content: z.string().min(1).max(5000),
  imageUrls: z.array(z.string()).max(5).optional(),
});

const postIdParamSchema = z.string().uuid();

const createCommentBodySchema = z.object({
  content: z.string().min(1).max(2000),
});

const reactBodySchema = z.object({
  type: z.literal("like"),
});

const patchPostBodySchema = z
  .object({
    isPinned: z.boolean().optional(),
    isLocked: z.boolean().optional(),
    isDeleted: z.boolean().optional(),
  })
  .strict();

const commentAgg = db
  .select({
    postId: comments.postId,
    commentCount: sql<number>`(count(*))::int`.as("commentCount"),
  })
  .from(comments)
  .where(eq(comments.isDeleted, false))
  .groupBy(comments.postId)
  .as("comment_agg");

const reactionAgg = db
  .select({
    postId: reactions.postId,
    reactionCount: sql<number>`(count(*))::int`.as("reactionCount"),
  })
  .from(reactions)
  .groupBy(reactions.postId)
  .as("reaction_agg");

function hasBuildingId(buildingId: string): boolean {
  return buildingId !== "";
}

function mapPostRow(row: {
  id: string;
  buildingId: string;
  category: string;
  title: string | null;
  content: string;
  imageUrls: string[] | null;
  isPinned: boolean;
  isLocked: boolean;
  createdAt: Date;
  updatedAt: Date;
  authorId: string;
  authorFullName: string;
  authorAvatarUrl: string | null;
  commentCount: number | null;
  reactionCount: number | null;
}) {
  return {
    id: row.id,
    buildingId: row.buildingId,
    category: row.category,
    title: row.title,
    content: row.content,
    imageUrls: row.imageUrls ?? [],
    isPinned: row.isPinned,
    isLocked: row.isLocked,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: {
      id: row.authorId,
      fullName: row.authorFullName,
      avatarUrl: row.authorAvatarUrl,
    },
    commentCount: row.commentCount ?? 0,
    reactionCount: row.reactionCount ?? 0,
  };
}

const feedPostsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate);

  fastify.get("/posts", async (request, reply) => {
    if (!hasBuildingId(request.user.buildingId)) {
      return createError(
        reply,
        403,
        "You must join a building before accessing the feed",
      );
    }

    const { cursor, limit } = parsePaginationParams(
      request.query as Record<string, unknown>,
    );

    const rawCategory = (request.query as Record<string, unknown>).category;
    let category: FeedPostCategory | undefined;
    if (rawCategory !== undefined && rawCategory !== "") {
      const parsedCategory = feedPostCategorySchema.safeParse(rawCategory);
      if (!parsedCategory.success) {
        return createError(reply, 400, "Invalid category");
      }
      category = parsedCategory.data;
    }

    let cursorDecoded: ReturnType<typeof decodeCursor> = null;
    if (cursor !== undefined) {
      cursorDecoded = decodeCursor(cursor);
      if (cursorDecoded === null) {
        return createError(reply, 400, "Invalid cursor");
      }
    }

    const conditions = [
      eq(posts.buildingId, request.user.buildingId),
      eq(posts.isDeleted, false),
    ];

    if (category !== undefined) {
      conditions.push(eq(posts.category, category));
    }

    if (cursorDecoded !== null) {
      conditions.push(
        sql`(${posts.createdAt}, ${posts.id}) < (${cursorDecoded.createdAt}::timestamptz, ${cursorDecoded.id}::uuid)`,
      );
    }

    const fetchLimit = limit + 1;

    const rows = await db
      .select({
        id: posts.id,
        buildingId: posts.buildingId,
        category: posts.category,
        title: posts.title,
        content: posts.content,
        imageUrls: posts.imageUrls,
        isPinned: posts.isPinned,
        isLocked: posts.isLocked,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
        authorId: users.id,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
        commentCount: commentAgg.commentCount,
        reactionCount: reactionAgg.reactionCount,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .leftJoin(commentAgg, eq(commentAgg.postId, posts.id))
      .leftJoin(reactionAgg, eq(reactionAgg.postId, posts.id))
      .where(and(...conditions))
      .orderBy(desc(posts.isPinned), desc(posts.createdAt), desc(posts.id))
      .limit(fetchLimit);

    const items = rows.map(mapPostRow);
    const page = buildPaginatedResponse(items, limit, (item) => ({
      createdAt: item.createdAt,
      id: item.id,
    }));

    return reply.send(page);
  });

  fastify.post("/posts", async (request, reply) => {
    if (!hasBuildingId(request.user.buildingId)) {
      return createError(
        reply,
        403,
        "You must join a building before accessing the feed",
      );
    }

    const parsed = createPostBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ errors: parsed.error.flatten() });
    }

    const body = parsed.data;

    if (
      body.category === "announcement" &&
      request.user.role !== "manager" &&
      request.user.role !== "org_admin"
    ) {
      return createError(
        reply,
        403,
        "Only managers can create announcements",
      );
    }

    const [inserted] = await db
      .insert(posts)
      .values({
        buildingId: request.user.buildingId,
        orgId: request.user.orgId,
        authorId: request.user.id,
        category: body.category,
        title: body.title,
        content: body.content,
        imageUrls: body.imageUrls,
      })
      .returning();

    if (inserted === undefined) {
      fastify.log.error("insert post returned no row");
      return createError(reply, 500, "Failed to create post");
    }

    await db.insert(auditLogs).values({
      orgId: request.user.orgId,
      buildingId: request.user.buildingId,
      userId: request.user.id,
      action: "post.create",
      resourceType: "post",
      resourceId: inserted.id,
      metadata: { category: body.category },
    });

    const [author] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(eq(users.id, request.user.id))
      .limit(1);

    if (author === undefined) {
      fastify.log.error({ userId: request.user.id }, "author not found after insert");
      return createError(reply, 500, "Failed to create post");
    }

    const response = {
      id: inserted.id,
      buildingId: inserted.buildingId,
      category: inserted.category,
      title: inserted.title,
      content: inserted.content,
      imageUrls: inserted.imageUrls ?? [],
      isPinned: inserted.isPinned,
      isLocked: inserted.isLocked,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
      author: {
        id: author.id,
        fullName: author.fullName,
        avatarUrl: author.avatarUrl,
      },
      commentCount: 0,
      reactionCount: 0,
    };

    return reply.status(201).send(response);
  });

  fastify.get<{ Params: { id: string } }>("/posts/:id", async (request, reply) => {
    if (!hasBuildingId(request.user.buildingId)) {
      return createError(
        reply,
        403,
        "You must join a building before accessing the feed",
      );
    }

    const idParsed = postIdParamSchema.safeParse(request.params.id);
    if (!idParsed.success) {
      return createError(reply, 400, "Invalid post id");
    }
    const postId = idParsed.data;

    const [postRow] = await db
      .select({
        id: posts.id,
        buildingId: posts.buildingId,
        category: posts.category,
        title: posts.title,
        content: posts.content,
        imageUrls: posts.imageUrls,
        isPinned: posts.isPinned,
        isLocked: posts.isLocked,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
        authorId: users.id,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
        reactionCount: reactionAgg.reactionCount,
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .leftJoin(reactionAgg, eq(reactionAgg.postId, posts.id))
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.buildingId, request.user.buildingId),
          eq(posts.isDeleted, false),
        ),
      )
      .limit(1);

    if (postRow === undefined) {
      return createError(reply, 404, "Post not found");
    }

    const commentRows = await db
      .select({
        id: comments.id,
        content: comments.content,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        authorId: users.id,
        authorFullName: users.fullName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(and(eq(comments.postId, postId), eq(comments.isDeleted, false)))
      .orderBy(asc(comments.createdAt));

    const commentsPayload = commentRows.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      author: {
        id: c.authorId,
        fullName: c.authorFullName,
        avatarUrl: c.authorAvatarUrl,
      },
    }));

    return reply.send({
      id: postRow.id,
      buildingId: postRow.buildingId,
      category: postRow.category,
      title: postRow.title,
      content: postRow.content,
      imageUrls: postRow.imageUrls ?? [],
      isPinned: postRow.isPinned,
      isLocked: postRow.isLocked,
      createdAt: postRow.createdAt,
      updatedAt: postRow.updatedAt,
      author: {
        id: postRow.authorId,
        fullName: postRow.authorFullName,
        avatarUrl: postRow.authorAvatarUrl,
      },
      comments: commentsPayload,
      reactionCount: postRow.reactionCount ?? 0,
    });
  });

  fastify.post<{ Params: { id: string } }>(
    "/posts/:id/comments",
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(
          reply,
          403,
          "You must join a building before accessing the feed",
        );
      }

      const idParsed = postIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid post id");
      }
      const postId = idParsed.data;

      const parsed = createCommentBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const [postForComment] = await db
        .select({
          id: posts.id,
          buildingId: posts.buildingId,
          isLocked: posts.isLocked,
          isDeleted: posts.isDeleted,
        })
        .from(posts)
        .where(
          and(eq(posts.id, postId), eq(posts.buildingId, request.user.buildingId)),
        )
        .limit(1);

      if (postForComment === undefined) {
        return createError(reply, 404, "Post not found");
      }

      if (postForComment.isDeleted) {
        return createError(reply, 404, "Post not found");
      }

      if (postForComment.isLocked) {
        return createError(reply, 403, "This post has been locked");
      }

      const [insertedComment] = await db
        .insert(comments)
        .values({
          postId,
          buildingId: postForComment.buildingId,
          authorId: request.user.id,
          content: parsed.data.content,
        })
        .returning();

      if (insertedComment === undefined) {
        fastify.log.error("insert comment returned no row");
        return createError(reply, 500, "Failed to create comment");
      }

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId,
        userId: request.user.id,
        action: "comment.create",
        resourceType: "comment",
        resourceId: insertedComment.id,
        metadata: { postId },
      });

      const [author] = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, request.user.id))
        .limit(1);

      if (author === undefined) {
        fastify.log.error({ userId: request.user.id }, "author not found after comment");
        return createError(reply, 500, "Failed to create comment");
      }

      return reply.status(201).send({
        id: insertedComment.id,
        postId: insertedComment.postId,
        buildingId: insertedComment.buildingId,
        content: insertedComment.content,
        createdAt: insertedComment.createdAt,
        updatedAt: insertedComment.updatedAt,
        author: {
          id: author.id,
          fullName: author.fullName,
          avatarUrl: author.avatarUrl,
        },
      });
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/posts/:id/react",
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(
          reply,
          403,
          "You must join a building before accessing the feed",
        );
      }

      const idParsed = postIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid post id");
      }
      const postId = idParsed.data;

      const parsed = reactBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const [postForReact] = await db
        .select({ id: posts.id, buildingId: posts.buildingId })
        .from(posts)
        .where(
          and(
            eq(posts.id, postId),
            eq(posts.buildingId, request.user.buildingId),
            eq(posts.isDeleted, false),
          ),
        )
        .limit(1);

      if (postForReact === undefined) {
        return createError(reply, 404, "Post not found");
      }

      const [existingReaction] = await db
        .select({ id: reactions.id })
        .from(reactions)
        .where(
          and(eq(reactions.postId, postId), eq(reactions.userId, request.user.id)),
        )
        .limit(1);

      if (existingReaction !== undefined) {
        await db.delete(reactions).where(eq(reactions.id, existingReaction.id));
      } else {
        await db.insert(reactions).values({
          postId,
          userId: request.user.id,
          buildingId: postForReact.buildingId,
          type: parsed.data.type,
        });
      }

      const [countRow] = await db
        .select({ reactionCount: sql<number>`(count(*))::int` })
        .from(reactions)
        .where(eq(reactions.postId, postId));

      const reactionCount = countRow?.reactionCount ?? 0;

      return reply.send({
        reacted: existingReaction === undefined,
        reactionCount,
      });
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    "/posts/:id",
    { preHandler: [requireRole("manager", "org_admin")] },
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(
          reply,
          403,
          "You must join a building before accessing the feed",
        );
      }

      const idParsed = postIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid post id");
      }
      const postId = idParsed.data;

      const parsed = patchPostBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const body = parsed.data;
      if (
        body.isPinned === undefined &&
        body.isLocked === undefined &&
        body.isDeleted === undefined
      ) {
        return createError(reply, 400, "No fields to update");
      }

      const [updated] = await db
        .update(posts)
        .set({
          ...(body.isPinned !== undefined ? { isPinned: body.isPinned } : {}),
          ...(body.isLocked !== undefined ? { isLocked: body.isLocked } : {}),
          ...(body.isDeleted !== undefined ? { isDeleted: body.isDeleted } : {}),
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(posts.id, postId), eq(posts.buildingId, request.user.buildingId)),
        )
        .returning({ id: posts.id });

      if (updated === undefined) {
        return createError(reply, 404, "Post not found");
      }

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId,
        userId: request.user.id,
        action: "post.update",
        resourceType: "post",
        resourceId: postId,
        metadata: body,
      });

      const [row] = await db
        .select({
          id: posts.id,
          buildingId: posts.buildingId,
          category: posts.category,
          title: posts.title,
          content: posts.content,
          imageUrls: posts.imageUrls,
          isPinned: posts.isPinned,
          isLocked: posts.isLocked,
          createdAt: posts.createdAt,
          updatedAt: posts.updatedAt,
          authorId: users.id,
          authorFullName: users.fullName,
          authorAvatarUrl: users.avatarUrl,
          commentCount: commentAgg.commentCount,
          reactionCount: reactionAgg.reactionCount,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .leftJoin(commentAgg, eq(commentAgg.postId, posts.id))
        .leftJoin(reactionAgg, eq(reactionAgg.postId, posts.id))
        .where(eq(posts.id, postId))
        .limit(1);

      if (row === undefined) {
        return createError(reply, 404, "Post not found");
      }

      return reply.send(mapPostRow(row));
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/posts/:id",
    { preHandler: [requireRole("manager", "org_admin")] },
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(
          reply,
          403,
          "You must join a building before accessing the feed",
        );
      }

      const idParsed = postIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid post id");
      }
      const postId = idParsed.data;

      const [updated] = await db
        .update(posts)
        .set({ isDeleted: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(posts.id, postId),
            eq(posts.buildingId, request.user.buildingId),
            eq(posts.isDeleted, false),
          ),
        )
        .returning({ id: posts.id });

      if (updated === undefined) {
        return createError(reply, 404, "Post not found");
      }

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId,
        userId: request.user.id,
        action: "post.delete",
        resourceType: "post",
        resourceId: postId,
      });

      return reply.send({ message: "Post removed" });
    },
  );
};

export default feedPostsRoutes;
