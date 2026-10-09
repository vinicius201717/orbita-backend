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
      const queue = await this.jobs.health();
      if (queue.worker !== 'up')
        throw new ServiceUnavailableException({ code: 'WORKER_NOT_READY', message: 'Operational worker unavailable' });
      return { status: 'ok', postgres: 'up', postgis: 'up', redis: 'up', queue };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Infrastructure unavailable' });
    }
  }
}
