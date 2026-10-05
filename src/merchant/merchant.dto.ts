import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CargoCategory, DeliveryServiceLevel } from '@prisma/client';
import { CustomerDto, DropoffDto } from '../deliveries/deliveries.dto';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class CreateProductDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  category: string;

  @ApiProperty({ minimum: 1, maximum: 10000000 })
  @IsInt()
  @Min(1)
  @Max(10000000)
  priceCents: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto, { skipNullProperties: false }) {}

export class OrderItemDto {
  @ApiProperty() @IsUUID() productId: string;
  @ApiProperty({ minimum: 1, maximum: 100 }) @IsInt() @Min(1) @Max(100) quantity: number;
}

export class CreateOrderDto {
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

  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  address: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [OrderItemDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiPropertyOptional({ enum: DeliveryServiceLevel, default: 'SMART' })
  @IsOptional()
  @IsEnum(DeliveryServiceLevel)
  serviceLevel?: DeliveryServiceLevel;

  @ApiPropertyOptional({ enum: CargoCategory, default: 'AMBIENT' })
  @IsOptional()
  @IsEnum(CargoCategory)
  category?: CargoCategory;

  @ApiPropertyOptional({ minimum: 0, maximum: 120, default: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  preparationMinutes?: number;
}

export class OrderListDto {
  @ApiPropertyOptional({ enum: ['preparing', 'ready', 'on-the-way', 'completed', 'attention', 'cancelled'] })
  @IsOptional()
  @IsIn(['preparing', 'ready', 'on-the-way', 'completed', 'attention', 'cancelled'])
  stage?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
