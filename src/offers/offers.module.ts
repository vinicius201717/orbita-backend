import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
@Module({
  imports: [MatchingModule],
  providers: [OffersService],
  controllers: [OffersController],
  exports: [OffersService],
})
export class OffersModule {}
