import { ApiProperty, PartialType } from '@nestjs/swagger';
import { BusinessCategory } from '@prisma/client';
import {
  IsString,
  MaxLength,
  MinLength,
  IsEmail,
  Matches,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsTimeZone,
  IsNumber,
  IsBoolean,
} from 'class-validator';
export class CreateBusinessDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(180) legalName: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) tradeName: string;
  @ApiProperty() @Matches(/^\d{11,14}$/) document: string;
  @ApiProperty() @Matches(/^\+[1-9]\d{7,14}$/) phone: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ enum: BusinessCategory }) @IsEnum(BusinessCategory) category: BusinessCategory;
}
export class UpdateBusinessDto extends PartialType(CreateBusinessDto) {}
export class CreateBranchDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) address: string;
  @ApiProperty() @IsNumber() @IsLatitude() latitude: number;
  @ApiProperty() @IsNumber() @IsLongitude() longitude: number;
  @ApiProperty({ required: false }) @IsOptional() @IsTimeZone() timezone?: string;
}
export class UpdateBranchDto extends PartialType(CreateBranchDto) {
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() active?: boolean;
}
