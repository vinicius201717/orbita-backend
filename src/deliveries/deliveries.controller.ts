import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Public, Roles } from '../auth/auth.decorators';
import { Actor } from '../common/actor';
import {
  ConfirmDeliveryDto,
  CreateDeliveryDto,
  DeliveryListDto,
  UpdateDeliveryDto,
  VerifyDeliveryDto,
} from './deliveries.dto';
import { DeliveriesService } from './deliveries.service';

@ApiTags('deliveries')
@ApiBearerAuth()
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly service: DeliveriesService) {}
  @Post()
  @Roles('ADMIN', 'BUSINESS_OWNER', 'BUSINESS_STAFF')
  @ApiOperation({ summary: 'Create an independent delivery in the pool' })
  create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateDeliveryDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.create(actor, dto, key);
  }
  @Get()
  @ApiOperation({ summary: 'List authorized deliveries using a cursor' })
  list(@CurrentActor() actor: Actor, @Query() query: DeliveryListDto) {
    return this.service.list(actor, query);
  }
  @Get(':id') get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(actor, id);
  }
  @Post(':id/customer-code')
  @Roles('ADMIN', 'BUSINESS_OWNER', 'BUSINESS_STAFF')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Privately retrieve the stable customer PIN for an active delivery, including after assignment; never share with the driver',
  })
  customerCode(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.customerCode(actor, id);
  }
  @Patch(':id')
  @Roles('ADMIN', 'BUSINESS_OWNER', 'BUSINESS_STAFF')
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryDto,
  ) {
    return this.service.update(actor, id, dto);
  }
  @Post(':id/ready')
  @Roles('ADMIN', 'BUSINESS_OWNER', 'BUSINESS_STAFF')
  ready(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.ready(actor, id);
  }
  @Post(':id/verify')
  @Roles('DRIVER')
  @ApiOperation({ summary: 'Confirm delivery using the recipient PIN and credit the ledger atomically' })
  verify(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyDeliveryDto,
  ) {
    return this.service.verify(actor, id, dto);
  }
  @Public()
  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm receipt using a private customer token' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDeliveryDto) {
    return this.service.confirm(id, dto.token);
  }
  @Public()
  @Post(':id/tracking')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Customer delivery status and ETA using a private token' })
  tracking(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDeliveryDto) {
    return this.service.customerTracking(id, dto.token);
  }
  @Public()
  @Get(':id/confirm')
  @ApiOperation({ summary: 'Customer receipt page; private token remains in the URL fragment' })
  confirmationPage(@Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    const nonce = randomBytes(16).toString('base64');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    response
      .type('html')
      .send(
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ORBITA — confirmação</title><body style="font-family:system-ui;max-width:34rem;padding:2rem;margin:auto"><h1>Confirme o recebimento</h1><p>Toque abaixo somente depois de receber seu pedido.</p><button id="confirm" type="button">Recebi meu pedido</button><p id="result" role="status"></p><script nonce="${nonce}">const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname);document.getElementById('confirm').onclick=async()=>{const button=document.getElementById('confirm');button.disabled=true;try{const response=await fetch('/api/v1/deliveries/${id}/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});document.getElementById('result').textContent=response.ok?'Entrega confirmada. Obrigado!':'Não foi possível confirmar. Verifique se recebeu o pedido ou fale com a empresa.';if(!response.ok)button.disabled=false;}catch{document.getElementById('result').textContent='Falha de conexão. Tente novamente.';button.disabled=false;}};</script></body></html>`,
      );
  }
}
