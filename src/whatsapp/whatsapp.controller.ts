import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators';
import { WhatsAppService } from './whatsapp.service';
@ApiTags('whatsapp')
@Public()
@Controller('webhooks/whatsapp')
export class WhatsAppController {
  constructor(private readonly service: WhatsAppService) {}
  @Get() verify(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') token: unknown,
    @Query('hub.challenge') challenge: unknown,
  ) {
    return this.service.challenge(mode, token, challenge);
  }
  @Post() @HttpCode(200) receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.service.receive(req.rawBody ?? Buffer.alloc(0), signature, body);
  }
}
