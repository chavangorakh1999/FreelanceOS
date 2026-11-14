import { PaymentMethod } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../common/pagination';
import { CURRENCIES, DECIMAL } from './invoices.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AllocationInput {
  @IsUUID() invoiceId: string;
  /** Cash taken from this payment. Decimal string. */
  @IsString() @Matches(DECIMAL, { message: 'amount must be a decimal string like "5000.00"' }) amount: string;
  /** Tax the payer withheld (e.g. TDS) against this invoice; settles it but is not cash. */
  @IsOptional() @IsString() @Matches(DECIMAL, { message: 'withholding must be a decimal string like "1000.00"' }) withholding?: string;
}

export class CreatePaymentDto {
  @IsUUID() clientId: string;
  @IsString() @Matches(DECIMAL, { message: 'amount must be a decimal string like "108000.00"' }) amount: string;
  @IsIn(CURRENCIES) currency: string;
  /** The date the money arrived. Cannot be in the future. */
  @Type(() => Date) @IsDate() receivedAt: Date;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationInput) allocations?: AllocationInput[];
}

export class AllocateDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AllocationInput) allocations: AllocationInput[];
}

export class ReversePaymentDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class ListPaymentsQuery extends PageQuery {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsIn(['unallocated', 'reversed', 'active']) view?: 'unallocated' | 'reversed' | 'active';
}

export class OverviewQuery {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}
