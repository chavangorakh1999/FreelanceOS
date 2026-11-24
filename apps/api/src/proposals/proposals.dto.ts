import { DecisionChannel, DecisionKind, PaymentTermKind, PricingModel, ProposalStatus, SectionKind } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'KWD'];

export class CreateProposalDto {
  /** Optional when a project is given: the client is taken from it. */
  @IsOptional() @IsUUID() clientId?: string;
  /** The project this proposal belongs to. */
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() engagementId?: string;
  @IsOptional() @IsUUID() templateId?: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsOptional() @IsIn(CURRENCIES) currency?: string;
}

export class SectionInput {
  @IsEnum(SectionKind) kind: SectionKind;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title: string;
  @IsString() @MaxLength(20000) body: string;
}

export class LineItemInput {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) description: string;
  /** Decimal string, up to 4 places. */
  @IsString() @Matches(/^\d+(\.\d{1,4})?$/, { message: 'quantity must be a decimal string like "2.5"' }) quantity: string;
  @IsOptional() @IsString() @MaxLength(30) unitLabel?: string;
  /** Decimal string in the version currency. */
  @IsString() @Matches(/^\d+(\.\d{1,3})?$/, { message: 'unitRate must be a decimal string like "1500.00"' }) unitRate: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) discountBps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) taxBps?: number;
}

export class PaymentTermInput {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) label: string;
  @IsEnum(PaymentTermKind) kind: PaymentTermKind;
  @IsOptional() @IsInt() @Min(0) @Max(10000) percentageBps?: number;
  @IsOptional() @IsString() @Matches(/^\d+(\.\d{1,3})?$/) amount?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) dueInDays?: number;
}

/** PUT replaces the whole content of a DRAFT version. */
export class SaveVersionDto {
  @IsEnum(PricingModel) pricingModel: PricingModel;
  @IsIn(CURRENCIES) currency: string;
  @IsOptional() @Type(() => Date) @IsDate() validUntil?: Date | null;
  @IsOptional() @IsString() @MaxLength(5000) summary?: string;
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => SectionInput) sections: SectionInput[];
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => LineItemInput) lineItems: LineItemInput[];
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PaymentTermInput) paymentTerms: PaymentTermInput[];
}

export class DecisionDto {
  @IsEnum(DecisionKind) decision: DecisionKind;
  @IsEnum(DecisionChannel) channel: DecisionChannel;
  @IsOptional() @Type(() => Date) @IsDate() decidedAt?: Date;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
}

export class ListProposalsQuery extends PageQuery {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() engagementId?: string;
  @IsOptional() @IsEnum(ProposalStatus) status?: ProposalStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
}
