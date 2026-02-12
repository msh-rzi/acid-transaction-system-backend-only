import { IsString, IsIn, IsBoolean, IsOptional } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  name: string;

  @IsString()
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'])
  type: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
