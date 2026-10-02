import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength, IsEnum, Matches } from 'class-validator';
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
