import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'KWD'];

export class CreateTimeDto {
  @Type(() => Date) @IsDate() date: Date;
  @IsInt() @Min(1) @Max(1440) minutes: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() taskId?: string;
  @IsOptional() @IsBoolean() billable?: boolean;
}
export class UpdateTimeDto {
  @IsOptional() @Type(() => Date) @IsDate() date?: Date;
  @IsOptional() @IsInt() @Min(1) @Max(1440) minutes?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() taskId?: string | null;
  @IsOptional() @IsBoolean() billable?: boolean;
}
export class StartTimerDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() taskId?: string;
}
export class BillTimeDto {
  /** Decimal string in `currency`, e.g. "45" or "3500.00". */
  @IsString() @Matches(/^\d+(\.\d{1,3})?$/, { message: 'rate must be a decimal string like "45.00"' }) rate: string;
  @IsIn(CURRENCIES) currency: string;
  /** One line per task (default), one per entry, or a single line for all hours. */
  @IsOptional() @IsIn(['task', 'entry', 'single']) groupBy?: 'task' | 'entry' | 'single';
  /** Defaults to every unbilled billable entry. */
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsUUID(undefined, { each: true }) entryIds?: string[];
}
export class ListTimeQuery {
  @IsOptional() @IsIn(['unbilled', 'billed', 'all']) show?: 'unbilled' | 'billed' | 'all';
}
