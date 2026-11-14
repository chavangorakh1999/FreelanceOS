import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetupDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(12) @MaxLength(200) password: string;
  @IsString() @MinLength(1) @MaxLength(120) workspaceName: string;
  @IsOptional() @IsIn(['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'KWD']) defaultCurrency?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword: string;
}
