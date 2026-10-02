import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { Actor } from './actor';
const logger = pino({ level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' });
@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  use(req: Request & { actor?: Actor }, res: Response, next: NextFunction) {
    const requestId = randomUUID();
    const started = Date.now();
    res.setHeader('X-Request-Id', requestId);
    res.once('finish', () =>
      logger.info({
        requestId,
        method: req.method,
        route: (req.route as { path?: string } | undefined)?.path ?? 'unmatched',
        statusCode: res.statusCode,
        durationMs: Date.now() - started,
        userId: req.actor?.id,
        businessId: req.actor?.businessId,
        driverId: req.actor?.driverId,
      }),
    );
    next();
  }
}
