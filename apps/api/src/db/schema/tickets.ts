import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { buildings, organizations } from './organizations.js';
import { users } from './users.js';

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedTo: uuid('assigned_to').references(() => users.id, {
      onDelete: 'set null',
    }),
    issueType: varchar('issue_type', { length: 100 }).notNull(),
    location: varchar('location', { length: 100 }).notNull(),
    description: text('description').notNull(),
    imageUrls: text('image_urls').array(),
    status: varchar('status', { length: 50 }).notNull().default('open'),
    priority: varchar('priority', { length: 20 }).notNull().default('normal'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('tickets_building_id_status_created_at_idx').on(
      table.buildingId,
      table.status,
      table.createdAt.desc(),
    ),
    index('tickets_submitted_by_idx').on(table.submittedBy),
    index('tickets_assigned_to_idx').on(table.assignedTo),
  ],
);

export const ticketUpdates = pgTable(
  'ticket_updates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    oldStatus: varchar('old_status', { length: 50 }),
    newStatus: varchar('new_status', { length: 50 }),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('ticket_updates_ticket_id_idx').on(table.ticketId)],
);

export type Ticket = InferSelectModel<typeof tickets>;
export type NewTicket = InferInsertModel<typeof tickets>;
export type TicketUpdate = InferSelectModel<typeof ticketUpdates>;
export type NewTicketUpdate = InferInsertModel<typeof ticketUpdates>;
