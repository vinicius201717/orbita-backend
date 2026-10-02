import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/infra/prisma.service';
import { hashPassword } from '../../src/common/crypto.service';
import { Actor } from '../../src/common/actor';
import { AuthService } from '../../src/auth/auth.service';
export const testPassword = 'Orbita-test-password-2026!';
export async function createTestApp() {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication({ bodyParser: false });
  configureApp(app);
  try {
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
export async function actorFixture(
  app: INestApplication,
  role: 'BUSINESS_OWNER' | 'DRIVER' | 'ADMIN',
  tag = randomUUID(),
) {
  const db = app.get(PrismaService);
  const email = `${role.toLowerCase()}-${tag}@example.test`;
  const phone = '+5562' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const user = await db.user.create({
    data: {
      email,
      name: `Test ${role}`,
      role,
      passwordHash: await hashPassword(testPassword),
      ...(role === 'DRIVER'
        ? {
            driver: {
              create: {
                phone,
                status: 'AVAILABLE',
                onboardingStatus: 'APPROVED',
                locationConsentAt: new Date(),
                vehicles: {
                  create: {
                    plate: `T${randomUUID().slice(0, 7).toUpperCase()}`,
                    type: 'MOTORCYCLE',
                    capacityUnits: 100,
                  },
                },
              },
            },
          }
        : {}),
    },
    include: { driver: true },
  });
  const tokens = await app.get(AuthService).login({ email, password: testPassword });
  const actor: Actor = { id: user.id, role, businessId: user.businessId, driverId: user.driver?.id ?? null };
  return { user, actor, email, phone, ...tokens };
}
export async function businessFixture(
  app: INestApplication,
  point = { latitude: -16.68, longitude: -49.25 },
) {
  const owner = await actorFixture(app, 'BUSINESS_OWNER');
  const api = request(app.getHttpServer());
  const response = await api
    .post('/api/v1/businesses')
    .auth(owner.accessToken, { type: 'bearer' })
    .send({
      legalName: 'Test company',
      tradeName: 'Test kitchen',
      document: String(Math.floor(Math.random() * 1e14)).padStart(14, '0'),
      phone: owner.phone,
      email: owner.email,
      category: 'FOOD',
    })
    .expect(201);
  const business = response.body as { id: string };
  const branchResponse = await api
    .post(`/api/v1/businesses/${business.id}/branches`)
    .auth(owner.accessToken, { type: 'bearer' })
    .send({ name: 'Central', address: 'Rua de teste', ...point, timezone: 'America/Sao_Paulo' })
    .expect(201);
  return {
    ...owner,
    actor: { ...owner.actor, businessId: business.id },
    business,
    branch: branchResponse.body as { id: string },
  };
}
