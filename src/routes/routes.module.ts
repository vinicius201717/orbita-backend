import { Module } from '@nestjs/common';
import { DeliveriesModule } from '../deliveries/deliveries.module';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { MapsModule } from '../maps/maps.module';
import { RouteRecalculationService } from './route-recalculation.service';
@Module({
  imports: [DeliveriesModule, MapsModule],
  controllers: [RoutesController],
  providers: [RoutesService, RouteRecalculationService],
  exports: [RoutesService, RouteRecalculationService],
})
export class RoutesModule {}
