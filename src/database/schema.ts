import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Accounts
export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'
  currency: text('currency').default('USD').notNull(),
  balance: numeric('balance', { precision: 20, scale: 4 })
    .default('0')
    .notNull(),
  isActive: boolean('is_active').default(true),
  version: integer('version').default(0).notNull(), // Optimistic Locking
  createdAt: timestamp('created_at').defaultNow(),
});

// Transactions
export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  description: text('description').notNull(),
  metadata: jsonb('metadata'),
  status: text('status').default('POSTED').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Postings
export const postings = pgTable('postings', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id')
    .references(() => transactions.id)
    .notNull(),
  accountId: integer('account_id')
    .references(() => accounts.id)
    .notNull(),
  amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
  direction: text('direction').notNull(), // 'DEBIT', 'CREDIT'
  createdAt: timestamp('created_at').defaultNow(),
});

// Audits
export const audits = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull(),
  action: text('action').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Relations
export const transactionsRelations = relations(transactions, ({ many }) => ({
  postings: many(postings),
}));

export const postingsRelations = relations(postings, ({ one }) => ({
  transaction: one(transactions, {
    fields: [postings.transactionId],
    references: [transactions.id],
  }),
  account: one(accounts, {
    fields: [postings.accountId],
    references: [accounts.id],
  }),
}));
