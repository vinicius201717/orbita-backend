import { Module } from '@nestjs/common';
import { MapsModule } from '../maps/maps.module';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { RouteInsertionEngine } from './route-insertion.engine';
import { PlanningService } from './planning.service';
import { RouteBuilderService } from './route-builder.service';
import { RouteCandidateService } from './route-candidate.service';
import { MatchingEngineService } from './matching-engine.service';
import { MatchingScoreService } from './matching-score.service';
@Module({
  imports: [MapsModule],
  providers: [
    PricingEngineService,
    RouteInsertionEngine,
    PlanningService,
    RouteBuilderService,
    RouteCandidateService,
    MatchingEngineService,
    MatchingScoreService,
  ],
  exports: [MatchingEngineService, PlanningService, RouteInsertionEngine, PricingEngineService],
})
export class MatchingModule {}
