import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CargoCategory, DeliveryServiceLevel, DeliveryStatus } from '@prisma/client';

export class CustomerDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+[1-9]\d{7,14}$/) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() optIn?: boolean;
}
export class DropoffDto {
  @ApiProperty() @IsNumber() @IsLatitude() latitude: number;
  @ApiProperty() @IsNumber() @IsLongitude() longitude: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) complement?: string;
}
export class DeliveryItemDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) quantity: number;
}
export class CreateDeliveryDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ type: CustomerDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;
  @ApiProperty({ type: DropoffDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => DropoffDto)
  dropoff: DropoffDto;
  @ApiProperty()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DeliveryItemDto)
  items: DeliveryItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsEnum(DeliveryServiceLevel) serviceLevel?: DeliveryServiceLevel;
  @ApiPropertyOptional() @IsOptional() @IsEnum(CargoCategory) category?: CargoCategory;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000) capacityUnits?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000000) weightGrams?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000000000) volumeCm3?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) temperatureRequirement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) packageType?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() estimatedReadyAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() pickupDeadline?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() deliveryDeadline?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(60) @Max(86400) maxDeliveryDurationSeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) externalReference?: string;
}
export class UpdateDeliveryDto {
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => DropoffDto) dropoff?: DropoffDto;
  @ApiPropertyOptional() @IsOptional() @IsDateString() estimatedReadyAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) complement?: string;
}
export class DeliveryListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsEnum(DeliveryStatus) status?: DeliveryStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() businessId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() driverId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() routeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(DeliveryServiceLevel) serviceLevel?: DeliveryServiceLevel;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
export class VerifyDeliveryDto {
  @ApiProperty() @Matches(/^\d{4}$/) code: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsLongitude() longitude?: number;
}
export class ConfirmDeliveryDto {
  @ApiProperty() @IsString() @Matches(/^[a-zA-Z0-9_-]{43}$/) token: string;
}
