import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { CancellationService } from './cancellation.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
@Module({
  imports: [DeliveriesModule],
  providers: [CancellationService, IncidentsService],
  controllers: [IncidentsController],
  exports: [CancellationService],
})
export class IncidentsModule {}
