import { z } from 'zod';
export const incomingSchema = z.object({
  id: z.string().min(1).max(200),
  from: z.string().regex(/^\d{8,15}$/),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string().max(4096) }).optional(),
  location: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .optional(),
  interactive: z
    .object({ button_reply: z.object({ id: z.string().max(256), title: z.string().optional() }).optional() })
    .optional(),
  button: z.object({ payload: z.string().max(256) }).optional(),
});
export const webhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.object({
                metadata: z.object({ phone_number_id: z.string() }).optional(),
                messages: z.array(incomingSchema).max(100).optional(),
              }),
            }),
          )
          .max(100),
      }),
    )
    .max(100),
});
export type IncomingMessage = z.infer<typeof incomingSchema>;
