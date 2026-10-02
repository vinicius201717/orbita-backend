import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
@Module({
  providers: [SettlementService, FinanceService],
  controllers: [FinanceController],
  exports: [SettlementService, FinanceService],
})
export class FinanceModule {}
