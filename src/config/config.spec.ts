import { environmentSchema } from './config.service';
describe('environment configuration', () => {
  it('fails closed if real payments are requested', () => {
    expect(environmentSchema.safeParse({ ...process.env, REAL_PAYMENTS_ENABLED: 'true' }).success).toBe(
      false,
    );
  });
  it('rejects shared JWT signing secrets', () => {
    expect(
      environmentSchema.safeParse({ ...process.env, JWT_REFRESH_SECRET: process.env.JWT_SECRET }).success,
    ).toBe(false);
  });
  it('requires real maps in production', () => {
    expect(environmentSchema.safeParse({ ...process.env, NODE_ENV: 'production' }).success).toBe(false);
  });
});
