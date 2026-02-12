import {
  Inject,
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { DrizzleAsyncProvider } from '../database/drizzle.provider';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { sql, desc } from 'drizzle-orm';

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: NodePgDatabase<typeof schema>,
  ) {}

  private static readonly AMOUNT_SCALE = 4;
  private static readonly MAX_POSTINGS = 200;

  private toScaledInt(amount: string): bigint {
    if (!/^-?\d+(\.\d{1,4})?$/.test(amount)) {
      throw new BadRequestException('Amount must be a valid numeric string');
    }

    const isNegative = amount.startsWith('-');
    const unsigned = isNegative ? amount.slice(1) : amount;
    const [whole, frac = ''] = unsigned.split('.');
    if (frac.length > TransactionsService.AMOUNT_SCALE) {
      throw new BadRequestException('Amount has too many decimal places');
    }

    const paddedFrac = frac.padEnd(TransactionsService.AMOUNT_SCALE, '0');
    const normalized = `${whole}${paddedFrac}`.replace(/^0+(?=\d)/, '');
    const value = BigInt(normalized || '0');
    return isNegative ? -value : value;
  }

  private validatePostings(dto: CreateTransactionDto): bigint {
    if (!dto.postings?.length || dto.postings.length < 2) {
      throw new BadRequestException(
        'Transaction must have at least 2 postings',
      );
    }
    if (dto.postings.length > TransactionsService.MAX_POSTINGS) {
      throw new BadRequestException('Too many postings in one transaction');
    }

    let sum = 0n;
    for (const p of dto.postings) {
      if (p.direction !== 'DEBIT' && p.direction !== 'CREDIT') {
        throw new BadRequestException('Invalid posting direction');
      }
      const amount = this.toScaledInt(p.amount);
      if (amount <= 0n) {
        throw new BadRequestException(
          'Posting amount must be greater than zero',
        );
      }
      sum += p.direction === 'DEBIT' ? amount : -amount;
    }

    if (sum !== 0n) {
      throw new BadRequestException(
        `Transaction not balanced. Imbalance: ${sum}`,
      );
    }

    return sum;
  }

  async create(dto: CreateTransactionDto) {
    // 1. App-Level Validation: Check if balanced and valid
    this.validatePostings(dto);

    // 2. ACID Transaction with Pessimistic Locking
    return await this.db.transaction(async (tx) => {
      try {
        // Sort IDs to prevent Deadlocks (e.g. Tx A locks 1 then 2; Tx B locks 2 then 1)
        const accountIds = Array.from(
          new Set(dto.postings.map((p) => p.accountId)),
        ).sort((a, b) => a - b);

        if (accountIds.length === 0) {
          throw new BadRequestException('No account IDs provided');
        }

        // A. LOCK ACCOUNTS: SELECT ... FOR UPDATE
        // We use raw SQL for the locking clause as it guarantees the row lock behavior in Postgres.
        const idParams = accountIds.map((id) => sql`${id}`);
        const lockedAccountsResult = await tx.execute(
          sql`SELECT id, balance, type, currency, is_active
              FROM accounts
              WHERE id IN (${sql.join(idParams, sql`, `)})
              FOR UPDATE`,
        );

        if (lockedAccountsResult.rowCount !== accountIds.length) {
          throw new BadRequestException('One or more accounts not found');
        }

        // Fraud/Integrity Rules
        const accountsById = new Map<number, any>();
        for (const row of lockedAccountsResult.rows) {
          accountsById.set(row.id, row);
        }

        const currencies = new Set<string>();
        for (const row of lockedAccountsResult.rows) {
          if (!row.is_active) {
            throw new BadRequestException('Inactive account in transaction');
          }
          currencies.add(row.currency);
        }
        if (currencies.size > 1) {
          throw new BadRequestException(
            'Cross-currency transactions not allowed',
          );
        }

        // Overdraft protection for ASSET and EXPENSE accounts
        const pendingChanges = new Map<number, bigint>();
        for (const p of dto.postings) {
          const amount = this.toScaledInt(p.amount);
          const signed = p.direction === 'DEBIT' ? amount : -amount;
          pendingChanges.set(
            p.accountId,
            (pendingChanges.get(p.accountId) ?? 0n) + signed,
          );
        }
        for (const [accountId, delta] of pendingChanges.entries()) {
          const acc = accountsById.get(accountId);
          const current = this.toScaledInt(acc.balance as string);
          const next = current + delta;
          if ((acc.type === 'ASSET' || acc.type === 'EXPENSE') && next < 0n) {
            throw new BadRequestException(
              `Insufficient funds on account ${accountId}`,
            );
          }
        }

        // B. Create Transaction Record
        const [newTx] = await tx
          .insert(schema.transactions)
          .values({
            description: dto.description,
            metadata: {},
            status: 'POSTED',
          })
          .returning();

        // C. Process Postings & Update Balances
        const newPostings: (typeof schema.postings.$inferSelect)[] = [];
        for (const p of dto.postings) {
          const signedAmount =
            p.direction === 'DEBIT' ? p.amount : `-${p.amount}`;

          // Insert Posting
          const [posting] = await tx
            .insert(schema.postings)
            .values({
              transactionId: newTx.id,
              accountId: p.accountId,
              amount: p.amount,
              direction: p.direction,
            })
            .returning();
          newPostings.push(posting);

          // Update Balance (In-place update)
          await tx.execute(
            sql`UPDATE accounts
                SET balance = balance + ${signedAmount}::numeric,
                    version = version + 1
                WHERE id = ${p.accountId}`,
          );
        }

        // D. Audit Log (Inside transaction for atomicity)
        await tx.insert(schema.audits).values({
          entityType: 'TRANSACTION',
          entityId: newTx.id,
          action: 'CREATE',
          details: { dto, txId: newTx.id },
        });

        return { ...newTx, postings: newPostings };
      } catch (error) {
        // Drizzle automatically rolls back on error
        if (error instanceof BadRequestException) throw error;
        throw new InternalServerErrorException(error.message);
      }
    });
  }

  async findAll() {
    // Eager loading example using Drizzle's query builder features
    return await this.db.query.transactions.findMany({
      limit: 50,
      orderBy: [desc(schema.transactions.createdAt)],
      with: {
        postings: true,
      },
    });
  }
}
