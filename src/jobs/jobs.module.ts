import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { MatchingModule } from '../matching/matching.module';
import { OffersModule } from '../offers/offers.module';
import { MessagingModule } from '../messaging/messaging.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { JobsService } from './jobs.service';
import { RoutesModule } from '../routes/routes.module';
@Module({
  imports: [
    DriversModule,
    MatchingModule,
    OffersModule,
    MessagingModule,
    WhatsAppModule,
    RealtimeModule,
    RoutesModule,
  ],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
