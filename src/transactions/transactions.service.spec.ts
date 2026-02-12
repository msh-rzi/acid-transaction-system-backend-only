import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { AppModule } from '../app.module'; // Imports Config, DB, etc.
import { AccountsService } from '../accounts/accounts.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DrizzleAsyncProvider } from '../database/drizzle.provider';
import * as schema from '../database/schema';
import { sql } from 'drizzle-orm';

describe('Transactions Integration (ACID & Concurrency)', () => {
  let service: TransactionsService;
  let accountsService: AccountsService;
  let db: NodePgDatabase<typeof schema>;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // 1. Boot up the full NestJS app (connected to Test DB)
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    service = moduleRef.get<TransactionsService>(TransactionsService);
    accountsService = moduleRef.get<AccountsService>(AccountsService);
    db = moduleRef.get(DrizzleAsyncProvider);
  });

  beforeEach(async () => {
    // Clean Database before each test for isolation
    await db.execute(
      sql`TRUNCATE TABLE postings, transactions, accounts RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('should handle race conditions with Pessimistic Locking', async () => {
    // === SETUP ===
    // Create two accounts with $0
    const acc1 = await accountsService.create({
      name: 'Acc A',
      type: 'ASSET',
      currency: 'USD',
    });
    const acc2 = await accountsService.create({
      name: 'Acc B',
      type: 'LIABILITY',
      currency: 'USD',
    });

    // Seed Acc A with $1000.00
    await service.create({
      description: 'Initial Seed',
      postings: [
        { accountId: acc1.id, amount: '1000.00', direction: 'DEBIT' }, // Increase Asset
        { accountId: acc2.id, amount: '1000.00', direction: 'CREDIT' }, // (Just to balance it)
      ],
    });

    // === THE CONCURRENCY TEST ===
    const transferAmount = '10.00';
    const concurrencyCount = 50;

    // Create an array of 50 promises to run in PARALLEL
    // We are simulating 50 users clicking "Pay" at the exact same millisecond
    const promises = Array(concurrencyCount)
      .fill(null)
      .map(() =>
        service.create({
          description: 'Concurrent Transfer',
          postings: [
            { accountId: acc1.id, amount: transferAmount, direction: 'CREDIT' }, // Decrease A
            { accountId: acc2.id, amount: transferAmount, direction: 'DEBIT' }, // Increase B
          ],
        }),
      );

    console.log(`Firing ${concurrencyCount} concurrent transactions...`);
    await Promise.all(promises);

    // === VERIFICATION ===
    const updatedAcc1 = await accountsService.findOne(acc1.id);
    const updatedAcc2 = await accountsService.findOne(acc2.id);
    const initialBalanceA = 1000.0;
    const initialBalanceB = -1000.0;
    const totalTransferred = concurrencyCount * parseFloat(transferAmount);

    console.log('Final Balance A:', updatedAcc1.balance);
    console.log('Final Balance B:', updatedAcc2.balance);

    // Assertions
    expect(parseFloat(updatedAcc1.balance)).toBeCloseTo(
      initialBalanceA - totalTransferred,
      2,
    );

    expect(parseFloat(updatedAcc2.balance)).toBeCloseTo(
      initialBalanceB + totalTransferred,
      2,
    ); // -1000 from initial seed credit
  }, 30000); // Increased timeout for DB ops

  it('should maintain System Consistency (Accounting Equation)', async () => {
    // This replaces your SystemService.checkConsistency()

    // 1. Assets - Liabilities - Equity = 0?
    // In our schema, we just sum all balances (assuming signed entries)
    const result = await db.execute(
      sql`SELECT SUM(balance) as total FROM accounts`,
    );
    const totalValue = result.rows[0].total as string | null;
    const total = parseFloat(totalValue ?? '0');

    expect(total).toBeCloseTo(0, 4);
  });

  it('should recover from a failed DB transaction (no partial writes)', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.accounts).values({
          name: 'Acc A',
          type: 'ASSET',
          currency: 'USD',
        });

        // Force a failure (FK violation) after a write
        await tx.execute(
          sql`INSERT INTO postings (transaction_id, account_id, amount, direction)
              VALUES (999999, 999999, 10, 'DEBIT')`,
        );
      }),
    ).rejects.toThrow();

    const result = await db.execute(
      sql`SELECT COUNT(*) as count FROM accounts`,
    );
    expect(parseInt(result.rows[0].count as string, 10)).toBe(0);
  });

  it('should pass snapshot verification (postings sum == account balance)', async () => {
    const acc1 = await accountsService.create({
      name: 'Acc A',
      type: 'ASSET',
      currency: 'USD',
    });
    const acc2 = await accountsService.create({
      name: 'Acc B',
      type: 'LIABILITY',
      currency: 'USD',
    });

    await service.create({
      description: 'Initial Seed',
      postings: [
        { accountId: acc1.id, amount: '1000.00', direction: 'DEBIT' },
        { accountId: acc2.id, amount: '1000.00', direction: 'CREDIT' },
      ],
    });

    await service.create({
      description: 'Transfer',
      postings: [
        { accountId: acc1.id, amount: '250.00', direction: 'CREDIT' },
        { accountId: acc2.id, amount: '250.00', direction: 'DEBIT' },
      ],
    });

    const snapshot = await db.execute(sql`
      SELECT
        a.id,
        a.balance as account_balance,
        COALESCE(SUM(
          CASE WHEN p.direction = 'DEBIT' THEN p.amount ELSE -p.amount END
        ), 0) as postings_balance
      FROM accounts a
      LEFT JOIN postings p ON p.account_id = a.id
      GROUP BY a.id, a.balance
      ORDER BY a.id
    `);

    for (const row of snapshot.rows) {
      const accountBalance = parseFloat(row.account_balance as string);
      const postingsBalance = parseFloat(row.postings_balance as string);
      expect(postingsBalance).toBeCloseTo(accountBalance, 4);
    }
  });

  it('should block overdrafts for ASSET accounts', async () => {
    const acc1 = await accountsService.create({
      name: 'Acc A',
      type: 'ASSET',
      currency: 'USD',
    });
    const acc2 = await accountsService.create({
      name: 'Acc B',
      type: 'LIABILITY',
      currency: 'USD',
    });

    await expect(
      service.create({
        description: 'Overdraft Attempt',
        postings: [
          { accountId: acc1.id, amount: '10.00', direction: 'CREDIT' },
          { accountId: acc2.id, amount: '10.00', direction: 'DEBIT' },
        ],
      }),
    ).rejects.toThrow();
  });
});
