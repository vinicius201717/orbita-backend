import { ApiProperty } from '@nestjs/swagger';
import {
  DeliveryStatus,
  DriverStatus,
  OnboardingStatus,
  ReadinessStatus,
  RouteStatus,
  StopStatus,
  StopType,
} from '@prisma/client';

export class DriverSummaryProfileDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: DriverStatus }) status: DriverStatus;
  @ApiProperty() acceptNewOrders: boolean;
  @ApiProperty({ enum: OnboardingStatus }) onboardingStatus: OnboardingStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) locationConsentAt: Date | null;
  @ApiProperty({ enum: ['FRESH', 'STALE'] }) presence: 'FRESH' | 'STALE';
}
export class DriverSummaryWalletDto {
  @ApiProperty({ description: 'Net posted ledger balance in cents; does not promise a withdrawal.' })
  balanceCents: number;
  @ApiProperty({ enum: ['BRL'] }) currency: 'BRL';
}
export class DriverSummaryTodayDto {
  @ApiProperty({ example: '2026-10-05' }) date: string;
  @ApiProperty({ enum: ['America/Sao_Paulo'] }) timeZone: 'America/Sao_Paulo';
  @ApiProperty({ description: 'Settled delivery payout plus tips posted during this local day.' })
  earningsCents: number;
  @ApiProperty() completedDeliveries: number;
}
export class DriverSummaryRouteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: RouteStatus }) status: RouteStatus;
  @ApiProperty() version: number;
  @ApiProperty() remainingStops: number;
  @ApiProperty() totalStops: number;
  @ApiProperty() remainingDeliveries: number;
  @ApiProperty({ description: 'Offered payout for the route, not yet a posted balance.' })
  driverPayoutCents: number;
}
export class DriverSummaryNavigationDto {
  @ApiProperty() googleMapsUrl: string;
  @ApiProperty() wazeUrl: string;
}
export class DriverSummaryStopDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) deliveryId: string;
  @ApiProperty({ enum: StopType }) type: StopType;
  @ApiProperty({ enum: StopStatus }) status: StopStatus;
  @ApiProperty() sequence: number;
  @ApiProperty() latitude: number;
  @ApiProperty() longitude: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) estimatedArrivalAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ReadinessStatus }) readinessStatus: ReadinessStatus;
  @ApiProperty({ enum: DeliveryStatus }) deliveryStatus: DeliveryStatus;
  @ApiProperty({ type: DriverSummaryNavigationDto }) navigation: DriverSummaryNavigationDto;
}
export class DriverSummaryDto {
  @ApiProperty({ type: DriverSummaryProfileDto }) driver: DriverSummaryProfileDto;
  @ApiProperty({ type: DriverSummaryWalletDto }) wallet: DriverSummaryWalletDto;
  @ApiProperty({ type: DriverSummaryTodayDto }) today: DriverSummaryTodayDto;
  @ApiProperty({ type: DriverSummaryRouteDto, nullable: true }) currentRoute: DriverSummaryRouteDto | null;
  @ApiProperty({ type: DriverSummaryStopDto, nullable: true }) nextStop: DriverSummaryStopDto | null;
}
