import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../config/config.service';
import { MessagePayload, MessagingProvider } from './messaging.provider';
@Injectable()
export class WhatsAppCloudProvider extends MessagingProvider {
  constructor(private readonly config: ConfigService) {
    super();
  }
  async send(to: string, payload: MessagePayload, withinWindow: boolean) {
    let message: unknown;
    if (!withinWindow) {
      const template = this.config.get('WHATSAPP_NOTIFICATION_TEMPLATE');
      if (!template) throw new Error('APPROVED_TEMPLATE_REQUIRED');
      message = {
        type: 'template',
        template: {
          name: template,
          language: { code: 'pt_BR' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: payload.text }] }],
        },
      };
    } else if (payload.kind === 'text') message = { type: 'text', text: { body: payload.text } };
    else
      message = {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: payload.text },
          action: { buttons: payload.buttons.map((button) => ({ type: 'reply', reply: button })) },
        },
      };
    const response = await fetch(
      `https://graph.facebook.com/${this.config.get('WHATSAPP_API_VERSION')}/${encodeURIComponent(this.config.get('WHATSAPP_PHONE_NUMBER_ID'))}/messages`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${this.config.get('WHATSAPP_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace(/^\+/, ''),
          ...(message as Record<string, unknown>),
        }),
      },
    );
    if (!response.ok) throw new Error(`WHATSAPP_HTTP_${response.status}`);
    const result = z
      .object({ messages: z.array(z.object({ id: z.string() })).min(1) })
      .parse(await response.json());
    return result.messages[0]?.id ?? '';
  }
}
