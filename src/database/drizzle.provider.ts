import { Injectable, OnModuleDestroy, Provider } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DrizzleAsyncProvider = 'drizzleProvider';

@Injectable()
export class DrizzleService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.db = drizzle(this.pool, { schema });
  }

  getDb() {
    return this.db;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

export const drizzleProvider: Provider = {
  provide: DrizzleAsyncProvider,
  useFactory: (drizzleService: DrizzleService) => drizzleService.getDb(),
  inject: [DrizzleService],
};
