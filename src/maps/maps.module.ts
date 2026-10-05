import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { MapsProvider } from './maps.provider';
import { MockMapsProvider } from './mock-maps.provider';
import { GoogleMapsProvider } from './google-maps.provider';
import { BusinessAddressesController } from './business-addresses.controller';
@Module({
  controllers: [BusinessAddressesController],
  providers: [
    MockMapsProvider,
    GoogleMapsProvider,
    {
      provide: MapsProvider,
      useFactory: (config: ConfigService, mock: MockMapsProvider, google: GoogleMapsProvider) =>
        config.get('MAPS_PROVIDER') === 'google' ? google : mock,
      inject: [ConfigService, MockMapsProvider, GoogleMapsProvider],
    },
  ],
  exports: [MapsProvider],
})
export class MapsModule {}
