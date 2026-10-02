import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
export interface Economics {
  revenueCents: number;
  driverPayoutCents: number;
  platformMarginCents: number;
  extraDistanceMeters: number;
  extraDurationSeconds: number;
  driverEstimatedCentsPerHour: number;
  driverEstimatedCentsPerKm: number;
}
@Injectable()
export class PricingEngineService {
  constructor(private readonly config: ConfigService) {}
  quote(
    revenueCents: number,
    count: number,
    distanceMeters: number,
    durationSeconds: number,
  ): Economics | null {
    const payout = Math.max(
      count * this.config.get('BASE_PAYOUT_CENTS'),
      Math.ceil((distanceMeters * this.config.get('MIN_DRIVER_CENTS_PER_KM')) / 1000),
      Math.ceil((durationSeconds * this.config.get('MIN_DRIVER_CENTS_PER_HOUR')) / 3600),
    );
    if (
      !Number.isSafeInteger(payout) ||
      revenueCents - payout < this.config.get('MIN_PLATFORM_MARGIN_CENTS') * count
    )
      return null;
    return {
      revenueCents,
      driverPayoutCents: payout,
      platformMarginCents: revenueCents - payout,
      extraDistanceMeters: distanceMeters,
      extraDurationSeconds: durationSeconds,
      driverEstimatedCentsPerHour: durationSeconds ? Math.floor((payout * 3600) / durationSeconds) : 0,
      driverEstimatedCentsPerKm: distanceMeters ? Math.floor((payout * 1000) / distanceMeters) : 0,
    };
  }
}
