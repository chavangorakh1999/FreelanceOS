import { DecisionChannel, ScopeDecision, ScopeItemKind } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength, MinLength, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ScopeItemInput {
  /** Keep the key of an existing item so the delta between versions can be computed. Omit for a new item. */
  @IsOptional() @IsUUID() itemKey?: string;
  @IsEnum(ScopeItemKind) kind: ScopeItemKind;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string;
}

export class SaveScopeDto {
  @IsOptional() @IsString() @MaxLength(5000) summary?: string;
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ScopeItemInput) items: ScopeItemInput[];
}

export class ScopeDecisionDto {
  @IsEnum(ScopeDecision) decision: ScopeDecision;
  @IsEnum(DecisionChannel) channel: DecisionChannel;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) approverName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @Type(() => Date) @IsDate() decidedAt?: Date;
}

export class DiffQuery {
  @Type(() => Number) @IsInt() @Min(1) from: number;
  @Type(() => Number) @IsInt() @Min(1) to: number;
}
