import 'dotenv/config';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { isIP } from 'node:net';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(String(fallback) as 'true' | 'false')
    .transform((v) => v === 'true');
const positive = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const nonnegative = (fallback: number) => z.coerce.number().int().nonnegative().default(fallback);
export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: positive(3000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    CORS_ORIGINS: z.string().min(1),
    TRUST_PROXY_CIDRS: z.string().default('').refine((value) => value.split(',').filter((part) => part.trim()).every((part) => {
      const [address, mask, ...extra] = part.trim().split('/');
      const family = isIP(address ?? '');
      return !extra.length && family !== 0 && (mask === undefined || (/^\d+$/.test(mask) && Number(mask) > 0 && Number(mask) <= (family === 4 ? 32 : 128)));
    }), 'Use explicit proxy IPs or CIDRs; global trust and hop counts are not allowed'),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    PIN_PEPPER: z.string().min(32),
    OUTBOX_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    JWT_ACCESS_TTL_SECONDS: positive(900),
    JWT_REFRESH_TTL_SECONDS: positive(2592000),
    WHATSAPP_ENABLED: bool(false),
    WHATSAPP_ACCESS_TOKEN: z.string().default(''),
    WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().default(''),
    WHATSAPP_APP_SECRET: z.string().default(''),
    WHATSAPP_API_VERSION: z.string().default('v23.0'),
    WHATSAPP_NOTIFICATION_TEMPLATE: z.string().default(''),
    GOOGLE_MAPS_API_KEY: z.string().default(''),
    MAPS_PROVIDER: z.enum(['mock', 'google']).default('mock'),
    DYNAMIC_ROUTE_INSERTION_ENABLED: bool(true),
    MULTI_PICKUP_ENABLED: bool(true),
    REAL_PAYMENTS_ENABLED: bool(false),
    OFFER_TTL_SECONDS: positive(30),
    POOL_INTERVAL_SECONDS: positive(10),
    GPS_TTL_SECONDS: positive(90),
    GPS_HISTORY_SAMPLE_SECONDS: positive(30),
    GPS_RETENTION_DAYS: positive(7),
    DEFAULT_CAPACITY_UNITS: positive(10),
    DEFAULT_PICKUP_SLA_SECONDS: positive(1800),
    DEFAULT_DELIVERY_SLA_SECONDS: positive(3600),
    DEFAULT_MAX_DELIVERY_SECONDS: positive(2400),
    PIN_MAX_ATTEMPTS: positive(5),
    PIN_PROXIMITY_METERS: nonnegative(0),
    MATCH_RADIUS_METERS: positive(8000),
    MATCH_CANDIDATE_LIMIT: positive(15),
    MAX_ROUTE_DELIVERIES: positive(12),
    MAX_POOL_BATCH: positive(50),
    MATCH_EVALUATION_LIMIT: positive(5),
    BASE_REVENUE_CENTS: positive(700),
    BASE_PAYOUT_CENTS: positive(500),
    MIN_DRIVER_CENTS_PER_KM: nonnegative(150),
    MIN_DRIVER_CENTS_PER_HOUR: nonnegative(1500),
    MIN_PLATFORM_MARGIN_CENTS: nonnegative(0),
    WAIT_FREE_SECONDS: nonnegative(300),
    WAIT_FEE_CENTS_PER_MINUTE: nonnegative(50),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    SCORE_ECONOMY_WEIGHT: z.coerce.number().nonnegative().default(1),
    SCORE_DRIVER_WEIGHT: z.coerce.number().nonnegative().default(1),
    SCORE_RELIABILITY_WEIGHT: z.coerce.number().nonnegative().default(1),
    SCORE_CAPACITY_WEIGHT: z.coerce.number().nonnegative().default(100),
    SCORE_SLA_WEIGHT: z.coerce.number().nonnegative().default(1),
    SCORE_DISTANCE_PENALTY: z.coerce.number().nonnegative().default(1),
    SCORE_TIME_PENALTY: z.coerce.number().nonnegative().default(1),
    SMART_POOL_WAIT_SECONDS: nonnegative(20),
    ECONOMY_POOL_WAIT_SECONDS: nonnegative(60),
    MOCK_SPEED_METERS_PER_SECOND: positive(8),
    STOP_SERVICE_SECONDS: nonnegative(60),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET)
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'Use separate signing secrets' });
    if (env.REAL_PAYMENTS_ENABLED)
      ctx.addIssue({
        code: 'custom',
        path: ['REAL_PAYMENTS_ENABLED'],
        message: 'Real payments are not implemented; keep disabled',
      });
    if (
      env.WHATSAPP_ENABLED &&
      (!env.WHATSAPP_ACCESS_TOKEN ||
        !env.WHATSAPP_PHONE_NUMBER_ID ||
        !env.WHATSAPP_VERIFY_TOKEN ||
        !env.WHATSAPP_APP_SECRET)
    )
      ctx.addIssue({ code: 'custom', path: ['WHATSAPP_ENABLED'], message: 'WhatsApp credentials required' });
    if (env.MAPS_PROVIDER === 'google' && !env.GOOGLE_MAPS_API_KEY)
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_MAPS_API_KEY'], message: 'Maps key required' });
    if (env.NODE_ENV === 'production' && env.MAPS_PROVIDER === 'mock')
      ctx.addIssue({
        code: 'custom',
        path: ['MAPS_PROVIDER'],
        message: 'Production requires road-network estimates',
      });
    if (env.NODE_ENV === 'production' && !env.PUBLIC_BASE_URL.startsWith('https://'))
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_BASE_URL'],
        message: 'Production links must use HTTPS',
      });
    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.split(',').some((origin) => !origin.trim().startsWith('https://')))
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'Production CORS origins must use HTTPS',
      });
  });
export type Environment = z.infer<typeof environmentSchema>;
@Injectable()
export class ConfigService {
  readonly values: Environment;
  constructor() {
    this.values = environmentSchema.parse(process.env);
  }
  get<K extends keyof Environment>(key: K): Environment[K] {
    return this.values[key];
  }
}
