import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';
import { DeliveryStateMachineService } from './delivery-state-machine.service';
@Module({
  imports: [FinanceModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveryStateMachineService],
  exports: [DeliveriesService, DeliveryStateMachineService],
})
export class DeliveriesModule {}
