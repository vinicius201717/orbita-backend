import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  async transaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    // Serializable writes intentionally retry transient PostgreSQL serialization
    // failures. A short backoff prevents concurrent route acceptance from
    // immediately colliding on the same route-stop rows again.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(action, {
          isolationLevel: 'Serializable',
          maxWait: 10000,
          timeout: 15000,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt >= 5
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, 25 * 2 ** attempt)));
      }
    }
  }
}
