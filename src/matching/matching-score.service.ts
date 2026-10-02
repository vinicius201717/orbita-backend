import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { Economics } from '../pricing/pricing-engine.service';
import { Simulation } from './route-insertion.engine';
@Injectable()
export class MatchingScoreService {
  constructor(private readonly config: ConfigService) {}
  score(economics: Economics, simulation: Simulation, capacity: number, reliability: number) {
    return (
      economics.platformMarginCents * this.config.get('SCORE_ECONOMY_WEIGHT') +
      economics.driverEstimatedCentsPerHour * this.config.get('SCORE_DRIVER_WEIGHT') +
      (simulation.peakCapacityUnits / capacity) * this.config.get('SCORE_CAPACITY_WEIGHT') +
      simulation.minSlackSeconds * this.config.get('SCORE_SLA_WEIGHT') -
      economics.extraDistanceMeters * this.config.get('SCORE_DISTANCE_PENALTY') -
      economics.extraDurationSeconds * this.config.get('SCORE_TIME_PENALTY') +
      reliability * this.config.get('SCORE_RELIABILITY_WEIGHT')
    );
  }
}
