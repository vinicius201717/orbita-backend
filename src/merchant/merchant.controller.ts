import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import { CreateOrderDto, CreateProductDto, OrderListDto, UpdateProductDto } from './merchant.dto';
import { MerchantService } from './merchant.service';

@ApiTags('merchant')
@ApiBearerAuth()
@Roles('BUSINESS_OWNER', 'BUSINESS_STAFF')
@Controller('business')
export class MerchantController {
  constructor(private readonly service: MerchantService) {}

  @Get('products')
  @ApiOperation({ summary: 'List the current business catalog, including unavailable products' })
  products(@CurrentActor() actor: Actor) {
    return this.service.products(actor);
  }

  @Post('products')
  createProduct(@CurrentActor() actor: Actor, @Body() dto: CreateProductDto) {
    return this.service.createProduct(actor, dto);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.service.updateProduct(actor, id, dto);
  }

  @Get('orders/summary')
  @ApiOperation({ summary: 'Merchant operations and sales summary; today uses America/Sao_Paulo' })
  summary(@CurrentActor() actor: Actor) {
    return this.service.summary(actor);
  }

  @Get('orders')
  orders(@CurrentActor() actor: Actor, @Query() query: OrderListDto) {
    return this.service.orders(actor, query);
  }

  @Get('orders/:id')
  order(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.order(actor, id);
  }

  @Post('orders')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Unique per order, 1–100 characters' })
  @ApiOperation({ summary: 'Create an order with server-priced snapshots and its delivery atomically' })
  createOrder(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.createOrder(actor, dto, key);
  }
}
