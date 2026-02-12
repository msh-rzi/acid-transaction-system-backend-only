# ACID Transaction System (Backend Only)

A NestJS + PostgreSQL backend that implements a small, production-style, double-entry ledger with strict ACID guarantees. It validates balanced postings, locks accounts during writes, prevents overdrafts on asset/expense accounts, and writes an immutable audit record for every transaction.

## Problem and Solution (Technical)

### Problem

Financial systems that update multiple accounts concurrently are vulnerable to race conditions, imbalance, and inconsistent balances. A transfer must atomically create a transaction record, write debit/credit postings, and update account balances. If any step fails or a concurrent write interleaves mid-operation, the ledger can become incorrect.

### Solution

This backend enforces correctness at two layers:

- Application rules validate balanced double-entry postings, posting count limits, and account constraints before any write.
- Database transactions perform the multi-table write as a single ACID unit with row-level locks to prevent concurrent interference.

The result is an implementation that is safe under concurrency and guarantees the ledger stays consistent.

## ACID Guarantees (How They Are Achieved)

- **Atomicity**: The `create` flow runs inside a single database transaction. If any insert or balance update fails, the whole transaction is rolled back.
- **Consistency**: Validation enforces balanced postings, allowed directions, matching currency, and overdraft protection for `ASSET`/`EXPENSE` accounts.
- **Isolation**: Account rows are locked using `SELECT ... FOR UPDATE` to prevent concurrent writes from corrupting balances.
- **Durability**: Once committed, the transaction header, postings, and audit record are persisted in PostgreSQL.

## Highlights

- ACID transaction handling using Postgres row locks (`SELECT ... FOR UPDATE`)
- Double-entry posting validation (sum of debits equals sum of credits)
- Precision-safe amounts using 4 decimal places and integer normalization
- Overdraft protection for `ASSET` and `EXPENSE` accounts
- Audit log created inside the same database transaction
- Drizzle ORM schema and migrations

## Tech Stack

- NestJS (TypeScript)
- PostgreSQL
- Drizzle ORM + drizzle-kit

## Data Model

- `accounts`: ledger accounts with balance, type, currency, active flag, and version
- `transactions`: transaction headers
- `postings`: line items (debit/credit)
- `audit_logs`: immutable audit trail

## API

Base URL: `http://localhost:3000`

### `POST /transactions`

Create a balanced transaction with at least 2 postings.

Request body:

```json
{
  "description": "Transfer to savings",
  "postings": [
    { "accountId": 1, "amount": "150.0000", "direction": "DEBIT" },
    { "accountId": 2, "amount": "150.0000", "direction": "CREDIT" }
  ]
}
```

Response (shape):

```json
{
  "id": 123,
  "description": "Transfer to savings",
  "status": "POSTED",
  "createdAt": "2026-02-11T22:40:00.000Z",
  "postings": [
    {
      "id": 1,
      "transactionId": 123,
      "accountId": 1,
      "amount": "150.0000",
      "direction": "DEBIT"
    },
    {
      "id": 2,
      "transactionId": 123,
      "accountId": 2,
      "amount": "150.0000",
      "direction": "CREDIT"
    }
  ]
}
```

### `GET /transactions`

Returns the 50 most recent transactions with postings.

## Validation Rules

- At least 2 postings per transaction
- Maximum 200 postings per transaction
- `amount` is a numeric string with up to 4 decimal places
- All postings must be either `DEBIT` or `CREDIT`
- Total debits must equal total credits
- All accounts must exist, be active, and share the same currency
- `ASSET` and `EXPENSE` accounts cannot go negative

## Local Setup

### Prerequisites

- Nest.js
- pnpm
- PostgreSQL

### Environment

Create a `.env` file:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/acid_transaction_db
PORT=3000
```

### Install

```bash
pnpm install
```

### Database

Generate migrations (if schema changed):

```bash
pnpm run drizzle:generate
```

Run migrations:

```bash
pnpm run drizzle:migrate
```

### Run

```bash
# development
pnpm run start:dev

# production
pnpm run build
pnpm run start:prod
```

## Tests

```bash
pnpm run test
pnpm run test:transactions
```

## Scripts

- `pnpm run start:dev` - start in watch mode
- `pnpm run build` - compile TypeScript
- `pnpm run start:prod` - run compiled app
- `pnpm run test` - unit tests
- `pnpm run test:transactions` - focused transaction tests
- `pnpm run drizzle:generate` - generate migrations
- `pnpm run drizzle:migrate` - run migrations

## Project Structure

- `src/app.module.ts` - root module
- `src/database/schema.ts` - Drizzle schema
- `src/database/drizzle.provider.ts` - DB connection provider
- `src/transactions/transactions.service.ts` - ledger logic and ACID transaction flow
- `src/transactions/transactions.controller.ts` - HTTP endpoints

## Notes

This repository is backend-only and focuses on correctness and consistency under concurrent writes. It is intentionally minimal to highlight the transaction flow and validation logic.
