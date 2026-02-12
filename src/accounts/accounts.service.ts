import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { DrizzleAsyncProvider } from '../database/drizzle.provider';
import { CreateAccountDto } from './dto/create-account.dto';
import { eq } from 'drizzle-orm';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: NodePgDatabase<typeof schema>,
  ) {}

  async create(dto: CreateAccountDto) {
    const [newAccount] = await this.db
      .insert(schema.accounts)
      .values({
        name: dto.name,
        type: dto.type,
        currency: dto.currency || 'USD',
        isActive: dto.isActive ?? true,
      })
      .returning();
    return newAccount;
  }

  async findAll() {
    return await this.db
      .select()
      .from(schema.accounts)
      .orderBy(schema.accounts.id);
  }

  async findOne(id: number) {
    const [account] = await this.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, id));
    return account;
  }
}
