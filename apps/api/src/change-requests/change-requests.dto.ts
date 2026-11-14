import { ChangeDecisionKind, ChangeParty, DecisionChannel, RequesterType, RiskLevel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'KWD'];

export class CreateChangeRequestDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10000) description: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) reason: string;
  @IsEnum(RequesterType) requestedBy: RequesterType;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) requesterName?: string;
  @IsOptional() @Type(() => Date) @IsDate() requestedAt?: Date;
}

export class AssessmentDto {
  /** Signed decimal string; negative is a saving. Never a JSON number. */
  @IsString() @Matches(/^-?\d+(\.\d{1,3})?$/, { message: 'costDelta must be a decimal string like "20000.00" or "-5000.00"' }) costDelta: string;
  @IsIn(CURRENCIES) currency: string;
  @IsInt() @Min(-3650) @Max(3650) timelineDeltaDays: number;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) deliverablesImpact: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) dependenciesImpact: string;
  @IsEnum(RiskLevel) risk: RiskLevel;
  @IsOptional() @IsString() @MaxLength(5000) riskNotes?: string;
  /** Does the signed agreement need an addendum before this change can be worked on? */
  @IsBoolean() requiresAddendum: boolean;
}

export class ChangeDecisionDto {
  @IsEnum(ChangeParty) party: ChangeParty;
  @IsEnum(ChangeDecisionKind) decision: ChangeDecisionKind;
  @IsEnum(DecisionChannel) channel: DecisionChannel;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @Type(() => Date) @IsDate() decidedAt?: Date;
}

export class WithdrawDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class AddendumDto {
  /** How the addendum was completed (e.g. "Addendum 1 signed by both parties on 20 Nov"). */
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) note: string;
  @IsOptional() @IsUUID() agreementId?: string;
}
