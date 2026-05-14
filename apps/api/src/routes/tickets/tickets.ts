import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { db } from "../../db/client.js";
import { ticketUpdates, tickets } from "../../db/schema/tickets.js";
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

const ISSUE_TYPES = [
  "plumbing",
  "heating",
  "electrical",
  "appliance",
  "structural",
  "pest",
  "cleaning",
  "other",
] as const;

const LOCATIONS = [
  "unit",
  "hallway",
  "lobby",
  "elevator",
  "parking",
  "amenity",
  "exterior",
  "other",
] as const;

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const TICKET_STATUSES = [
  "open",
  "scheduled",
  "in_progress",
  "resolved",
  "closed",
] as const;

const MANAGER_STATUS_TARGETS = [
  "scheduled",
  "in_progress",
  "resolved",
  "closed",
] as const;

const issueTypeSchema = z.enum(ISSUE_TYPES);
const locationSchema = z.enum(LOCATIONS);
const prioritySchema = z.enum(PRIORITIES);
const listStatusFilterSchema = z.enum(TICKET_STATUSES);

const createTicketBodySchema = z.object({
  issueType: issueTypeSchema,
  location: locationSchema,
  description: z.string().min(10).max(3000),
  imageUrls: z.array(z.string()).max(5).optional(),
  priority: prioritySchema.default("normal"),
});

const patchTicketStatusBodySchema = z.object({
  status: z.enum(MANAGER_STATUS_TARGETS),
  message: z.string().max(1000).optional(),
});

const ticketIdParamSchema = z.string().uuid();

const NO_BUILDING_MESSAGE =
  "You must join a building before using tickets";

function hasBuildingId(buildingId: string): boolean {
  return buildingId !== "";
}

function isValidStatusTransition(from: string, to: string): boolean {
  const allowed: Record<string, readonly string[]> = {
    open: ["scheduled", "in_progress"],
    scheduled: ["in_progress"],
    in_progress: ["resolved"],
    resolved: ["closed"],
  };
  const next = allowed[from];
  return next !== undefined && next.includes(to);
}

function mapTicketRow(row: {
  id: string;
  buildingId: string;
  orgId: string;
  submittedBy: string;
  assignedTo: string | null;
  issueType: string;
  location: string;
  description: string;
  imageUrls: string[] | null;
  status: string;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    buildingId: row.buildingId,
    orgId: row.orgId,
    submittedBy: row.submittedBy,
    assignedTo: row.assignedTo,
    issueType: row.issueType,
    location: row.location,
    description: row.description,
    imageUrls: row.imageUrls ?? [],
    status: row.status,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const ticketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", authenticate);

  fastify.post("/", async (request, reply) => {
    if (!hasBuildingId(request.user.buildingId)) {
      return createError(reply, 403, NO_BUILDING_MESSAGE);
    }

    const parsed = createTicketBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ errors: parsed.error.flatten() });
    }

    const body = parsed.data;

    const [ticket] = await db
      .insert(tickets)
      .values({
        buildingId: request.user.buildingId,
        orgId: request.user.orgId,
        submittedBy: request.user.id,
        issueType: body.issueType,
        location: body.location,
        description: body.description,
        imageUrls: body.imageUrls,
        priority: body.priority,
      })
      .returning();

    if (ticket === undefined) {
      fastify.log.error("insert ticket returned no row");
      return createError(reply, 500, "Failed to create ticket");
    }

    await db.insert(ticketUpdates).values({
      ticketId: ticket.id,
      authorId: request.user.id,
      oldStatus: null,
      newStatus: "open",
      message: "Ticket submitted",
    });

    await db.insert(auditLogs).values({
      orgId: request.user.orgId,
      buildingId: request.user.buildingId,
      userId: request.user.id,
      action: "ticket.create",
      resourceType: "ticket",
      resourceId: ticket.id,
      metadata: { issueType: body.issueType, location: body.location },
    });

    return reply.status(201).send(mapTicketRow(ticket));
  });

  fastify.get("/", async (request, reply) => {
    if (!hasBuildingId(request.user.buildingId)) {
      return createError(reply, 403, NO_BUILDING_MESSAGE);
    }

    const { cursor, limit } = parsePaginationParams(
      request.query as Record<string, unknown>,
    );

    const rawStatus = (request.query as Record<string, unknown>).status;
    let statusFilter: (typeof TICKET_STATUSES)[number] | undefined;
    if (rawStatus !== undefined && rawStatus !== "") {
      const parsedStatus = listStatusFilterSchema.safeParse(rawStatus);
      if (!parsedStatus.success) {
        return createError(reply, 400, "Invalid status");
      }
      statusFilter = parsedStatus.data;
    }

    let cursorDecoded: ReturnType<typeof decodeCursor> = null;
    if (cursor !== undefined) {
      cursorDecoded = decodeCursor(cursor);
      if (cursorDecoded === null) {
        return createError(reply, 400, "Invalid cursor");
      }
    }

    const conditions = [eq(tickets.buildingId, request.user.buildingId)];

    if (request.user.role === "resident") {
      conditions.push(eq(tickets.submittedBy, request.user.id));
    }

    if (statusFilter !== undefined) {
      conditions.push(eq(tickets.status, statusFilter));
    }

    if (cursorDecoded !== null) {
      conditions.push(
        sql`(${tickets.createdAt}, ${tickets.id}) < (${cursorDecoded.createdAt}::timestamptz, ${cursorDecoded.id}::uuid)`,
      );
    }

    const fetchLimit = limit + 1;

    const rows = await db
      .select({
        id: tickets.id,
        buildingId: tickets.buildingId,
        orgId: tickets.orgId,
        submittedBy: tickets.submittedBy,
        assignedTo: tickets.assignedTo,
        issueType: tickets.issueType,
        location: tickets.location,
        description: tickets.description,
        imageUrls: tickets.imageUrls,
        status: tickets.status,
        priority: tickets.priority,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
      })
      .from(tickets)
      .where(and(...conditions))
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(fetchLimit);

    const items = rows.map(mapTicketRow);
    const page = buildPaginatedResponse(items, limit, (item) => ({
      createdAt: item.createdAt,
      id: item.id,
    }));

    return reply.send(page);
  });

  fastify.patch<{ Params: { id: string } }>(
    "/:id/status",
    { preHandler: [requireRole("manager", "org_admin")] },
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(reply, 403, NO_BUILDING_MESSAGE);
      }

      const idParsed = ticketIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid ticket id");
      }
      const ticketId = idParsed.data;

      const parsed = patchTicketStatusBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const body = parsed.data;

      const [ticket] = await db
        .select({
          id: tickets.id,
          status: tickets.status,
          buildingId: tickets.buildingId,
        })
        .from(tickets)
        .where(
          and(
            eq(tickets.id, ticketId),
            eq(tickets.buildingId, request.user.buildingId),
          ),
        )
        .limit(1);

      if (ticket === undefined) {
        return createError(reply, 404, "Ticket not found");
      }

      if (!isValidStatusTransition(ticket.status, body.status)) {
        return createError(
          reply,
          400,
          `Invalid status transition from ${ticket.status} to ${body.status}`,
        );
      }

      const [updated] = await db
        .update(tickets)
        .set({
          status: body.status,
          updatedAt: sql`now()`,
        })
        .where(eq(tickets.id, ticketId))
        .returning();

      if (updated === undefined) {
        return createError(reply, 404, "Ticket not found");
      }

      await db.insert(ticketUpdates).values({
        ticketId,
        authorId: request.user.id,
        oldStatus: ticket.status,
        newStatus: body.status,
        message: body.message,
      });

      await db.insert(auditLogs).values({
        orgId: request.user.orgId,
        buildingId: request.user.buildingId,
        userId: request.user.id,
        action: "ticket.status_update",
        resourceType: "ticket",
        resourceId: ticketId,
        metadata: { from: ticket.status, to: body.status },
      });

      const updateRows = await db
        .select({
          id: ticketUpdates.id,
          oldStatus: ticketUpdates.oldStatus,
          newStatus: ticketUpdates.newStatus,
          message: ticketUpdates.message,
          createdAt: ticketUpdates.createdAt,
          authorId: users.id,
          authorFullName: users.fullName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(ticketUpdates)
        .innerJoin(users, eq(users.id, ticketUpdates.authorId))
        .where(eq(ticketUpdates.ticketId, ticketId))
        .orderBy(asc(ticketUpdates.createdAt));

      const updatesPayload = updateRows.map((u) => ({
        id: u.id,
        oldStatus: u.oldStatus,
        newStatus: u.newStatus,
        message: u.message,
        createdAt: u.createdAt,
        author: {
          id: u.authorId,
          fullName: u.authorFullName,
          avatarUrl: u.authorAvatarUrl,
        },
      }));

      return reply.send({
        ...mapTicketRow(updated),
        updates: updatesPayload,
      });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      if (!hasBuildingId(request.user.buildingId)) {
        return createError(reply, 403, NO_BUILDING_MESSAGE);
      }

      const idParsed = ticketIdParamSchema.safeParse(request.params.id);
      if (!idParsed.success) {
        return createError(reply, 400, "Invalid ticket id");
      }
      const ticketId = idParsed.data;

      const accessCondition =
        request.user.role === "resident"
          ? and(
              eq(tickets.id, ticketId),
              eq(tickets.buildingId, request.user.buildingId),
              eq(tickets.submittedBy, request.user.id),
            )
          : and(
              eq(tickets.id, ticketId),
              eq(tickets.buildingId, request.user.buildingId),
            );

      const [ticket] = await db
        .select({
          id: tickets.id,
          buildingId: tickets.buildingId,
          orgId: tickets.orgId,
          submittedBy: tickets.submittedBy,
          assignedTo: tickets.assignedTo,
          issueType: tickets.issueType,
          location: tickets.location,
          description: tickets.description,
          imageUrls: tickets.imageUrls,
          status: tickets.status,
          priority: tickets.priority,
          createdAt: tickets.createdAt,
          updatedAt: tickets.updatedAt,
        })
        .from(tickets)
        .where(accessCondition)
        .limit(1);

      if (ticket === undefined) {
        return createError(reply, 404, "Ticket not found");
      }

      const updateRows = await db
        .select({
          id: ticketUpdates.id,
          oldStatus: ticketUpdates.oldStatus,
          newStatus: ticketUpdates.newStatus,
          message: ticketUpdates.message,
          createdAt: ticketUpdates.createdAt,
          authorId: users.id,
          authorFullName: users.fullName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(ticketUpdates)
        .innerJoin(users, eq(users.id, ticketUpdates.authorId))
        .where(eq(ticketUpdates.ticketId, ticketId))
        .orderBy(asc(ticketUpdates.createdAt));

      const updatesPayload = updateRows.map((u) => ({
        id: u.id,
        oldStatus: u.oldStatus,
        newStatus: u.newStatus,
        message: u.message,
        createdAt: u.createdAt,
        author: {
          id: u.authorId,
          fullName: u.authorFullName,
          avatarUrl: u.authorAvatarUrl,
        },
      }));

      return reply.send({
        ...mapTicketRow(ticket),
        updates: updatesPayload,
      });
    },
  );
};

export default ticketRoutes;
