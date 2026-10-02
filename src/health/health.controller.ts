import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import { JobsService } from '../jobs/jobs.service';
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
    private readonly jobs: JobsService,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get() health() {
    return this.ready();
  }
  @Get('ready') async ready() {
    try {
      await Promise.all([this.db.$queryRaw`SELECT PostGIS_Version()`, this.redis.client.ping()]);
      return { status: 'ok', postgres: 'up', postgis: 'up', redis: 'up', queue: await this.jobs.health() };
    } catch {
      throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Infrastructure unavailable' });
    }
  }
}
