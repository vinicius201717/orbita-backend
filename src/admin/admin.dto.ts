import { ApiProperty } from '@nestjs/swagger';
import { IdentityType, OnboardingStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class ApproveDriverDto {
  @ApiProperty({ enum: OnboardingStatus }) @IsEnum(OnboardingStatus) status: OnboardingStatus;
}
export class IdentityDto {
  @ApiProperty() @Matches(/^\+[1-9]\d{7,14}$/) phoneNumber: string;
  @ApiProperty({ enum: IdentityType }) @IsEnum(IdentityType) entityType: IdentityType;
  @ApiProperty() @IsUUID() entityId: string;
  @ApiProperty({ description: 'Reference to recorded verification and opt-in evidence' })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  evidence: string;
}
export class AdjustmentDto {
  @ApiProperty() @IsUUID() walletId: string;
  @ApiProperty() @IsInt() @Min(-10000000) @Max(10000000) amountCents: number;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(500) reason: string;
  @ApiProperty() @Matches(/^[\w.-]{8,100}$/) idempotencyKey: string;
}
export class ZoneDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) city: string;
  @ApiProperty({ type: Object }) @IsObject() boundary: unknown;
}
