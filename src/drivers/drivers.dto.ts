import { ApiProperty } from '@nestjs/swagger';
import { CargoCategory, DriverStatus, VehicleType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
export class DriverStatusDto {
  @ApiProperty({ enum: DriverStatus }) @IsEnum(DriverStatus) status: DriverStatus;
}
export class DriverAvailabilityDto {
  @ApiProperty({
    description: 'Accept new offers. Turning off keeps an assigned route and its GPS operational.',
  })
  @IsBoolean()
  acceptingOrders: boolean;
}
export class ConsentDto {
  @ApiProperty() @IsBoolean() granted: boolean;
}
export class LocationDto {
  @ApiProperty() @IsNumber() @IsLatitude() latitude: number;
  @ApiProperty() @IsNumber() @IsLongitude() longitude: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(10000) accuracy?: number;
  @ApiProperty({ required: false, description: 'meters per second' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(400)
  speed?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(360) heading?: number;
  @ApiProperty() @IsISO8601() timestamp: string;
}
export class VehicleDto {
  @ApiProperty({ enum: VehicleType }) @IsEnum(VehicleType) type: VehicleType;
  @ApiProperty() @Matches(/^[A-Z0-9-]{6,10}$/) plate: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) brand?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) model?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1970) @Max(2100) year?: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) capacityUnits: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) weightCapacityGrams?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(1) volumeCapacityCm3?: number;
  @ApiProperty({ enum: CargoCategory, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsEnum(CargoCategory, { each: true })
  compatibleCategories?: CargoCategory[];
}
