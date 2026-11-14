import { AgreementStatus, SignatureMethod, SignerRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAgreementDto {
  @IsUUID() clientId: string;
  /** If given, the proposal must be ACCEPTED; the agreement records the exact accepted version. */
  @IsOptional() @IsUUID() proposalId?: string;
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsUUID() engagementId?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date;
}

export class ClauseInput {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) heading: string;
  @IsString() @MinLength(1) @MaxLength(20000) body: string;
}

export class SignerInput {
  @IsEnum(SignerRole) role: SignerRole;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name: string;
  @Transform(trim) @IsEmail() email: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsInt() @Min(1) @Max(20) signingOrder: number;
}

export class SaveAgreementVersionDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date | null;
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ClauseInput) clauses: ClauseInput[];
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SignerInput) signers: SignerInput[];
}

export class RecordEventDto {
  @IsIn(['VIEWED', 'SIGNED', 'DECLINED']) type: 'VIEWED' | 'SIGNED' | 'DECLINED';
  @IsOptional() @IsUUID() signerId?: string;
  @IsOptional() @IsEnum(SignatureMethod) method?: SignatureMethod;
  /** Required for a manually recorded signature: where the proof came from. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) evidence?: string;
  @IsOptional() @Type(() => Date) @IsDate() occurredAt?: Date;
}

export class VoidDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class ListAgreementsQuery extends PageQuery {
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsEnum(AgreementStatus) status?: AgreementStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
}
