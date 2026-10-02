import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MessagePayload, MessagingProvider } from './messaging.provider';
@Injectable()
export class MockMessagingProvider extends MessagingProvider {
  readonly sent: Array<{ to: string; payload: MessagePayload; id: string }> = [];
  async send(to: string, payload: MessagePayload) {
    const id = `mock-${randomUUID()}`;
    this.sent.push({ to, payload, id });
    if (this.sent.length > 1000) this.sent.shift();
    return id;
  }
}
