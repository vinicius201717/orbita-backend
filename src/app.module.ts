import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { InfraModule } from './infra/infra.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { BusinessesModule } from './businesses/businesses.module';
import { RateLimitGuard } from './common/rate-limit.guard';
import { LoggingMiddleware } from './common/logging.middleware';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { DriversModule } from './drivers/drivers.module';
import { RealtimeModule } from './realtime/realtime.module';
import { PrivacyController } from './users/privacy.controller';
import { RoutesModule } from './routes/routes.module';
import { MatchingModule } from './matching/matching.module';
import { OffersModule } from './offers/offers.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminModule } from './admin/admin.module';
import { JobsModule } from './jobs/jobs.module';
import { MetricsController } from './common/metrics.controller';
@Module({
  imports: [
    InfraModule,
    AuthModule,
    BusinessesModule,
    DeliveriesModule,
    DriversModule,
    RealtimeModule,
    RoutesModule,
    MatchingModule,
    OffersModule,
    WhatsAppModule,
    IncidentsModule,
    AnalyticsModule,
    AdminModule,
    JobsModule,
  ],
  controllers: [HealthController, PrivacyController, MetricsController],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('{*path}');
  }
}
