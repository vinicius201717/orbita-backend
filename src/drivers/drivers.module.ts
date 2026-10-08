import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { TrackingService } from '../tracking/tracking.service';
import { DriverSummaryService } from './driver-summary.service';
@Module({
  controllers: [DriversController],
  providers: [DriversService, TrackingService, DriverSummaryService],
  exports: [DriversService, TrackingService],
})
export class DriversModule {}
