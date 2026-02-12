import {
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEnum,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

class PostingDto {
  @IsNumber()
  accountId: number;

  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'Amount must be a valid numeric string',
  })
  amount: string;

  @IsEnum(['DEBIT', 'CREDIT'])
  direction: 'DEBIT' | 'CREDIT';
}

export class CreateTransactionDto {
  @IsString()
  description: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostingDto)
  postings: PostingDto[];
}
