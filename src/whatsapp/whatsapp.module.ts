import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { OffersModule } from '../offers/offers.module';
import { FinanceModule } from '../finance/finance.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { MessagingModule } from '../messaging/messaging.module';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
@Module({
  imports: [DeliveriesModule, OffersModule, FinanceModule, IncidentsModule, MessagingModule],
  providers: [WhatsAppService],
  controllers: [WhatsAppController],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
