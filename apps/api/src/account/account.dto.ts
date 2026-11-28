import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value);
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'KWD'];

export class ResetRequestDto { @IsEmail() email: string }
export class ResetConfirmDto {
  @IsString() @MinLength(20) @MaxLength(200) token: string;
  @IsString() @MinLength(12) @MaxLength(200) password: string;
}

/** Everything that appears on your invoices and proposals, plus defaults for new records. Blank text clears a field. */
export class UpdateProfileDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) legalName?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsEmail() email?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) addressLine1?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) addressLine2?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) region?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) postalCode?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @Matches(/^[A-Z]{2}$/, { message: 'country must be a two-letter code such as IN or US' }) country?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) taxIdentifier?: string | null;
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) paymentInstructions?: string | null;
  /** A UPI virtual payment address, e.g. name@okhdfcbank. */
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @Matches(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, { message: 'upiId looks like name@bank' }) upiId?: string | null;
  /** An https payment page; may contain {amount}, {currency} and {invoice}. */
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @MaxLength(500) @Matches(/^https:\/\/[^\s]+$/, { message: 'paymentLinkTemplate must be an https link' }) paymentLinkTemplate?: string | null;
  @IsOptional() @IsIn(CURRENCIES) defaultCurrency?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @Transform(trim) @Matches(/^[A-Z0-9-]{1,10}$/, { message: 'invoicePrefix uses capital letters, digits and dashes, up to 10' }) invoicePrefix?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) defaultPaymentTermsDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) defaultTaxBps?: number;
}
