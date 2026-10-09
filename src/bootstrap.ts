import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { ConfigService } from './config/config.service';
import { ApiExceptionFilter } from './common/exception.filter';
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  const trustedProxies = config.get('TRUST_PROXY_CIDRS').split(',').map((value) => value.trim()).filter(Boolean);
  app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies.length ? trustedProxies : false);
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(
    json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as typeof req & { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: false, limit: '16kb' }));
  app.enableCors({
    origin: config
      .get('CORS_ORIGINS')
      .split(',')
      .map((v) => v.trim()),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
