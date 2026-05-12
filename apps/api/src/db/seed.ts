import 'dotenv/config';

import { db } from './client.js';
import { buildings, organizations } from './schema/organizations.js';
import { userBuildingMemberships, users } from './schema/users.js';

function tuple2<T>(rows: T[], label: string): [T, T] {
  if (rows.length !== 2) {
    throw new Error(`${label}: expected 2 rows, got ${rows.length}`);
  }
  const a = rows[0];
  const b = rows[1];
  if (a === undefined || b === undefined) {
    throw new Error(`${label}: missing row`);
  }
  return [a, b];
}

function tuple4<T>(rows: T[], label: string): [T, T, T, T] {
  if (rows.length !== 4) {
    throw new Error(`${label}: expected 4 rows, got ${rows.length}`);
  }
  const a = rows[0];
  const b = rows[1];
  const c = rows[2];
  const d = rows[3];
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined
  ) {
    throw new Error(`${label}: missing row`);
  }
  return [a, b, c, d];
}

async function main(): Promise<void> {
  try {
    const [sunrise, maple] = tuple2(
      await db
        .insert(organizations)
        .values([
          {
            name: 'Sunrise Properties',
            slug: 'sunrise-properties',
            plan: 'enterprise',
          },
          {
            name: 'Maple Group',
            slug: 'maple-group',
            plan: 'professional',
          },
        ])
        .returning(),
      'organizations',
    );
    console.log('organization id:', sunrise.id);
    console.log('organization id:', maple.id);

    const [sunriseTowerA, mapleResidences] = tuple2(
      await db
        .insert(buildings)
        .values([
          {
            orgId: sunrise.id,
            name: 'Sunrise Tower A',
            address: '123 Main St',
            city: 'Toronto',
            country: 'Canada',
            timezone: 'America/Toronto',
          },
          {
            orgId: maple.id,
            name: 'Maple Residences',
            address: '456 Oak Ave',
            city: 'Vancouver',
            country: 'Canada',
            timezone: 'America/Vancouver',
          },
        ])
        .returning(),
      'buildings',
    );
    console.log('building id:', sunriseTowerA.id);
    console.log('building id:', mapleResidences.id);

    const [alice, bob, carol, dave] = tuple4(
      await db
        .insert(users)
        .values([
          {
            email: 'manager1@test.com',
            passwordHash: 'placeholder',
            fullName: 'Alice Manager',
          },
          {
            email: 'resident1@test.com',
            passwordHash: 'placeholder',
            fullName: 'Bob Resident',
          },
          {
            email: 'manager2@test.com',
            passwordHash: 'placeholder',
            fullName: 'Carol Manager',
          },
          {
            email: 'resident2@test.com',
            passwordHash: 'placeholder',
            fullName: 'Dave Resident',
          },
        ])
        .returning(),
      'users',
    );
    console.log('user id:', alice.id);
    console.log('user id:', bob.id);
    console.log('user id:', carol.id);
    console.log('user id:', dave.id);

    const [m1, m2, m3, m4] = tuple4(
      await db
        .insert(userBuildingMemberships)
        .values([
          {
            userId: alice.id,
            buildingId: sunriseTowerA.id,
            orgId: sunrise.id,
            role: 'manager',
          },
          {
            userId: bob.id,
            buildingId: sunriseTowerA.id,
            orgId: sunrise.id,
            role: 'resident',
          },
          {
            userId: carol.id,
            buildingId: mapleResidences.id,
            orgId: maple.id,
            role: 'manager',
          },
          {
            userId: dave.id,
            buildingId: mapleResidences.id,
            orgId: maple.id,
            role: 'resident',
          },
        ])
        .returning(),
      'user_building_memberships',
    );
    console.log('user_building_membership id:', m1.id);
    console.log('user_building_membership id:', m2.id);
    console.log('user_building_membership id:', m3.id);
    console.log('user_building_membership id:', m4.id);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void main();
