import { pgTable, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';
export const trackerData = pgTable('tracker_data', {
  userId: text('user_id').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const accountProfiles = pgTable('account_profiles', {
  userId: text('user_id').primaryKey(),
  username: text('username').notNull(),
  grade: text('grade').notNull(),
  age: integer('age').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
