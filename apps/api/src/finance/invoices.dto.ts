import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'KWD'];
/** Decimal string; never a JSON number. */
export const DECIMAL = /^\d+(\.\d{1,3})?$/;

export class InvoiceLineInput {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) description: string;
  @IsString() @Matches(/^\d+(\.\d{1,4})?$/, { message: 'quantity must be a decimal string like "2.5"' }) quantity: string;
  @IsOptional() @IsString() @MaxLength(30) unitLabel?: string;
  @IsString() @Matches(DECIMAL, { message: 'unitRate must be a decimal string like "1500.00"' }) unitRate: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) discountBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxBps?: number;
}

export class CreateInvoiceDto {
  @IsUUID() clientId: string;
  @IsOptional() @IsUUID() projectId?: string;
  /** Needs projectId. */
  @IsOptional() @IsUUID() milestoneId?: string;
  /** Needs projectId. Must be an APPROVED change request (invoice for approved additional work). */
  @IsOptional() @IsUUID() changeRequestId?: string;
  @IsOptional() @IsIn(CURRENCIES) currency?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InvoiceLineInput) lines?: InvoiceLineInput[];
}

/** PUT replaces the whole content of a DRAFT. */
export class SaveInvoiceDto {
  @IsIn(CURRENCIES) currency: string;
  @IsInt() @Min(0) @Max(365) paymentTermsDays: number;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InvoiceLineInput) lines: InvoiceLineInput[];
}

export class IssueInvoiceDto {
  /** Defaults to today in the workspace timezone. Cannot be in the future. */
  @IsOptional() @Type(() => Date) @IsDate() issueDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() dueDate?: Date;
}

export class VoidInvoiceDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class CreditNoteDto {
  @IsString() @Matches(DECIMAL, { message: 'amount must be a decimal string like "5000.00"' }) amount: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class ListInvoicesQuery extends PageQuery {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  /** open = issued with a balance, overdue = open and past due, paid = issued and fully settled */
  @IsOptional() @IsIn(['draft', 'open', 'overdue', 'paid', 'void']) view?: 'draft' | 'open' | 'overdue' | 'paid' | 'void';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
}
