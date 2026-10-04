import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, IsEnum, Matches, IsOptional } from 'class-validator';
export class IdentityDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ format: 'email' }) email: string;
  @ApiProperty({ enum: ['ADMIN', 'BUSINESS_OWNER', 'BUSINESS_STAFF', 'DRIVER'] }) role: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) businessId: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) driverId: string | null;
  @ApiProperty({ nullable: true, type: String }) phone: string | null;
}
export class UpdateAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;
}
export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(128) currentPassword: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(128) newPassword: string;
}
export class LoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(128) password: string;
}
export class RegisterDto extends LoginDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty({ enum: ['BUSINESS_OWNER', 'DRIVER'] })
  @IsEnum({ BUSINESS_OWNER: 'BUSINESS_OWNER', DRIVER: 'DRIVER' })
  role: 'BUSINESS_OWNER' | 'DRIVER';
  @ApiProperty() @Matches(/^\+[1-9]\d{7,14}$/) phone: string;
}
export class RefreshDto {
  @ApiProperty() @IsString() @MaxLength(2048) refreshToken: string;
}
