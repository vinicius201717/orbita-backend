import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { MatchingModule } from '../matching/matching.module';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { IncidentsModule } from '../incidents/incidents.module';
@Module({
  imports: [FinanceModule, DeliveriesModule, MatchingModule, IncidentsModule],
  providers: [AdminService, ServiceZonesService],
  controllers: [AdminController],
  exports: [ServiceZonesService, AdminService],
})
export class AdminModule {}
