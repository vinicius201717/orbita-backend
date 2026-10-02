import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { MessagingProvider } from './messaging.provider';
import { MockMessagingProvider } from './mock-messaging.provider';
import { WhatsAppCloudProvider } from './whatsapp-cloud.provider';
import { MessagingService } from './messaging.service';
@Module({
  providers: [
    MockMessagingProvider,
    WhatsAppCloudProvider,
    MessagingService,
    {
      provide: MessagingProvider,
      useFactory: (config: ConfigService, mock: MockMessagingProvider, cloud: WhatsAppCloudProvider) =>
        config.get('WHATSAPP_ENABLED') ? cloud : mock,
      inject: [ConfigService, MockMessagingProvider, WhatsAppCloudProvider],
    },
  ],
  exports: [MessagingService, MockMessagingProvider],
})
export class MessagingModule {}
