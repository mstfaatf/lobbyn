import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    plan: varchar('plan', { length: 50 }).notNull().default('starter'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('organizations_slug_idx').on(table.slug)],
);

export const buildings = pgTable(
  'buildings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    address: varchar('address', { length: 500 }).notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    country: varchar('country', { length: 100 }).notNull(),
    timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('buildings_org_id_idx').on(table.orgId)],
);

export type Organization = InferSelectModel<typeof organizations>;
export type NewOrganization = InferInsertModel<typeof organizations>;
export type Building = InferSelectModel<typeof buildings>;
export type NewBuilding = InferInsertModel<typeof buildings>;
