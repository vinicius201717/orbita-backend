import { z } from 'zod';
export const messageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(4096) }),
  z.object({
    kind: z.literal('buttons'),
    text: z.string().min(1).max(1024),
    buttons: z
      .array(z.object({ id: z.string().max(256), title: z.string().max(20) }))
      .min(1)
      .max(3),
  }),
]);
export type MessagePayload = z.infer<typeof messageSchema>;
export abstract class MessagingProvider {
  abstract send(to: string, payload: MessagePayload, withinWindow: boolean): Promise<string>;
}
