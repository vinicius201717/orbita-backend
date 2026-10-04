import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
export class DocumentOwnerDto {
  @ApiProperty({ enum: ['BUSINESS', 'DRIVER'] })
  @IsEnum({ BUSINESS: 'BUSINESS', DRIVER: 'DRIVER' })
  entityType: 'BUSINESS' | 'DRIVER';
  @ApiProperty({ format: 'uuid' }) @IsUUID() entityId: string;
}
export class UploadDocumentDto extends DocumentOwnerDto {
  @ApiProperty({ enum: ['IDENTITY', 'VEHICLE', 'BUSINESS', 'OTHER'] })
  @IsEnum({ IDENTITY: 'IDENTITY', VEHICLE: 'VEHICLE', BUSINESS: 'BUSINESS', OTHER: 'OTHER' })
  type: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() replacesId?: string;
}
export class ReviewDocumentDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum({ APPROVED: 'APPROVED', REJECTED: 'REJECTED' })
  status: 'APPROVED' | 'REJECTED';
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) notes: string;
}
