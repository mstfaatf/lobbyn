import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { buildings, organizations } from './organizations.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    avatarUrl: varchar('avatar_url', { length: 500 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

export const userBuildingMemberships = pgTable(
  'user_building_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => buildings.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull().default('resident'),
    unitNumber: varchar('unit_number', { length: 50 }),
    isActive: boolean('is_active').notNull().default(true),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('user_building_memberships_user_id_building_id_unique').on(
      table.userId,
      table.buildingId,
    ),
    index('user_building_memberships_user_id_idx').on(table.userId),
    index('user_building_memberships_building_id_idx').on(table.buildingId),
    index('user_building_memberships_org_id_idx').on(table.orgId),
  ],
);

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type UserBuildingMembership = InferSelectModel<
  typeof userBuildingMemberships
>;
export type NewUserBuildingMembership = InferInsertModel<
  typeof userBuildingMemberships
>;
