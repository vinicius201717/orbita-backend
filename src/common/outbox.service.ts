import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
@Injectable()
export class OutboxService {
  emit(tx: Prisma.TransactionClient, type: string, aggregateId: string, payload: Prisma.InputJsonValue) {
    return tx.outboxEvent.create({ data: { type, aggregateId, payload } });
  }
}
