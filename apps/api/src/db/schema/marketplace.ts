import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { buildings, organizations } from './organizations.js';
import { users } from './users.js';

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    price: numeric('price', { precision: 10, scale: 2 }),
    imageUrls: text('image_urls').array(),
    isActive: boolean('is_active').notNull().default(true),
    isDeleted: boolean('is_deleted').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    searchVector: tsvector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        sql.raw(
          `to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))`,
        ),
      ),
  },
  (table) => [
    index('listings_building_id_is_active_created_at_idx').on(
      table.buildingId,
      table.isActive,
      table.createdAt.desc(),
    ),
    index('listings_seller_id_idx').on(table.sellerId),
    index('listings_expires_at_idx').on(table.expiresAt),
    index('listings_search_vector_gin_idx').using('gin', table.searchVector),
  ],
);

export type Listing = InferSelectModel<typeof listings>;
export type NewListing = InferInsertModel<typeof listings>;
