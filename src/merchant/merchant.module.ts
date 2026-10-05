import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { MerchantController } from './merchant.controller';
import { MerchantService } from './merchant.service';

@Module({
  imports: [DeliveriesModule],
  controllers: [MerchantController],
  providers: [MerchantService],
})
export class MerchantModule {}
