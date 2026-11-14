import { ClientStatus, ClientType, InteractionType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDate, IsEmail, IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndef = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value);

export class ContactInput {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) firstName: string;
  @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @Transform(emptyToUndef) @IsEmail() email?: string;
  @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(100) jobTitle?: string;
  @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateContactDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @Transform(emptyToUndef) @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateClientDto {
  @IsEnum(ClientType) type: ClientType;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsOptional() @Transform(emptyToUndef) @IsEmail() email?: string;
  @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @Transform(emptyToUndef) @IsUrl({ require_protocol: true }) website?: string;
  @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(60) taxIdentifier?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  /** Optional first contact; it becomes the primary contact. */
  @IsOptional() @ValidateNested() @Type(() => ContactInput) primaryContact?: ContactInput;
}

export class UpdateClientDto {
  @IsOptional() @IsEnum(ClientType) type?: ClientType;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  @IsOptional() @Transform(emptyToUndef) @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @Transform(emptyToUndef) @IsUrl({ require_protocol: true }) website?: string;
  @IsOptional() @IsString() @MaxLength(60) taxIdentifier?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

export class ListClientsQuery extends PageQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(ClientType) type?: ClientType;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @IsEnum(['name', 'createdAt']) sort: 'name' | 'createdAt' = 'name';
}

export class CreateInteractionDto {
  @IsEnum(InteractionType) type: InteractionType;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) summary: string;
  @IsOptional() @Type(() => Date) @IsDate() occurredAt?: Date;
}
