import { Module, Global } from '@nestjs/common';
import { DrizzleService, drizzleProvider } from './drizzle.provider';

@Global()
@Module({
  providers: [DrizzleService, drizzleProvider],
  exports: [DrizzleService, drizzleProvider],
})
export class DatabaseModule {}
