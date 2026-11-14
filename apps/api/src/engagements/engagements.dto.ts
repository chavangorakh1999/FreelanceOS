import { RequirementKind } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'KWD'];
const DECIMAL = /^\d+(\.\d{1,3})?$/;

export class CreateEngagementDto {
  @IsUUID() clientId: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(100) serviceCategory?: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  /** Decimal string, e.g. "150000.00". Never a JSON number. */
  @IsOptional() @IsString() @Matches(DECIMAL, { message: 'estimatedValue must be a decimal string like "150000.00"' }) estimatedValue?: string;
  @IsOptional() @IsIn(CURRENCIES) currency?: string;
  @IsOptional() @IsUUID() stageId?: string;
  @IsOptional() @Type(() => Date) @IsDate() expectedStartDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() expectedCloseDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() followUpAt?: Date;
}

export class UpdateEngagementDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(100) serviceCategory?: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @Matches(DECIMAL) estimatedValue?: string;
  @IsOptional() @IsIn(CURRENCIES) currency?: string;
  @IsOptional() @Type(() => Date) @IsDate() expectedStartDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() expectedCloseDate?: Date;
  @IsOptional() @Type(() => Date) @IsDate() followUpAt?: Date;
}

export class MoveStageDto {
  @IsUUID() stageId: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) reason?: string;
  @IsOptional() @Type(() => Date) @IsDate() followUpAt?: Date;
}

export class ListEngagementsQuery extends PageQuery {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() stageId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) includeArchived: boolean = false;
}

export class AddRequirementDto {
  @IsOptional() @IsEnum(RequirementKind) kind?: RequirementKind;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(5000) detail?: string;
}
