import { Global, Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
@Global()
@Module({
  imports: [DriversModule],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
