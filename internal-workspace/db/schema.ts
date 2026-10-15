import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('cyber_workspaces', {
  ownerId: text('owner_id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  payload: text('payload').notNull(),
  writeToken: text('write_token').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const revisions = sqliteTable('cyber_revisions', {
  ownerId: text('owner_id').notNull(),
  revision: integer('revision').notNull(),
  payload: text('payload').notNull(),
  action: text('action').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({columns: [table.ownerId, table.revision]})]);
