import 'dotenv/config';
import { createHmac, randomInt } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/crypto.service';

/** Stable, isolated IDs make this development seed repeatable without deleting data. */
const id = (kind: number, index: number): string =>
  `0b17a000-${kind.toString(16).padStart(4, '0')}-4000-8000-${index.toString(16).padStart(12, '0')}`;

const businesses = [
  { name: 'Hamburgueria Órbita Demo', category: 'FOOD' },
  { name: 'Pizzaria Cerrado Demo', category: 'FOOD' },
  { name: 'Farmácia Central Demo', category: 'PHARMACY' },
] as const;
const branches = [
  { business: 0, name: 'Setor Bueno', latitude: -16.7085, longitude: -49.2701 },
  { business: 0, name: 'Setor Marista', latitude: -16.7043, longitude: -49.2632 },
  { business: 1, name: 'Setor Oeste', latitude: -16.6868, longitude: -49.2691 },
  { business: 1, name: 'Aparecida Centro', latitude: -16.8228, longitude: -49.2451 },
  { business: 2, name: 'Jardim Goiás', latitude: -16.7098, longitude: -49.2372 },
] as const;

async function seed(prisma: PrismaClient, passwordHash: string, pepper: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await tx.user.upsert({
        where: { id: id(1, 0) },
        update: {},
        create: {
          id: id(1, 0),
          email: 'admin@orbita.example',
          name: 'Admin Demo',
          passwordHash,
          role: 'ADMIN',
        },
      });
      await tx.wallet.upsert({
        where: { key: 'platform' },
        update: {},
        create: { id: id(7, 0), key: 'platform', type: 'PLATFORM' },
      });
      for (const [index, business] of businesses.entries()) {
        const businessId = id(2, index);
        const phone = `+55629000010${index.toString().padStart(2, '0')}`;
        await tx.business.upsert({
          where: { id: businessId },
          update: {},
          create: {
            id: businessId,
            legalName: `${business.name} — dados fictícios`,
            tradeName: business.name,
            document: `DEMO-ORBITA-${index}`,
            phone,
            email: `business${index + 1}@orbita.example`,
            category: business.category,
            billingMode: 'POSTPAID',
          },
        });
        await tx.user.upsert({
          where: { id: id(1, index + 1) },
          update: {},
          create: {
            id: id(1, index + 1),
            email: `business${index + 1}@orbita.example`,
            name: `${business.name} — proprietário demo`,
            passwordHash,
            role: 'BUSINESS_OWNER',
            businessId,
          },
        });
        await tx.wallet.upsert({
          where: { businessId },
          update: {},
          create: { id: id(7, index + 1), key: `business:${businessId}`, type: 'BUSINESS', businessId },
        });
        await tx.whatsAppIdentity.upsert({
          where: { id: id(8, index) },
          update: {},
          create: {
            id: id(8, index),
            phoneNumber: phone,
            entityType: 'BUSINESS',
            entityId: businessId,
            verifiedAt: now,
            optInAt: now,
          },
        });
      }
      for (const [index, branch] of branches.entries()) {
        await tx.businessBranch.upsert({
          where: { id: id(3, index) },
          update: {},
          create: {
            id: id(3, index),
            businessId: id(2, branch.business),
            name: branch.name,
            address: `Endereço demonstrativo — ${branch.name}, Goiás`,
            latitude: branch.latitude,
            longitude: branch.longitude,
            timezone: 'America/Sao_Paulo',
          },
        });
      }
      for (let index = 0; index < 10; index++) {
        const userId = id(1, index + 100);
        const driverId = id(4, index);
        const phone = `+55629000020${index.toString().padStart(2, '0')}`;
        const branch = branches[index % branches.length];
        if (!branch) throw new Error('Missing seed branch');
        await tx.user.upsert({
          where: { id: userId },
          update: {},
          create: {
            id: userId,
            email: `driver${index + 1}@orbita.example`,
            name: `Entregador Demo ${index + 1}`,
            passwordHash,
            role: 'DRIVER',
          },
        });
        await tx.driver.upsert({
          where: { id: driverId },
          update: {},
          create: {
            id: driverId,
            userId,
            phone,
            status: 'AVAILABLE',
            onboardingStatus: 'APPROVED',
            locationConsentAt: now,
            lastLocationAt: now,
            maxCapacityUnits: 100,
          },
        });
        await tx.consentRecord.upsert({
          where: { id: id(6, index) },
          update: {},
          create: {
            id: id(6, index),
            userId,
            purpose: 'OPERATIONAL_LOCATION',
            granted: true,
            version: 'demo-v1',
          },
        });
        await tx.vehicle.upsert({
          where: { id: id(5, index) },
          update: {},
          create: {
            id: id(5, index),
            driverId,
            type: 'MOTORCYCLE',
            plate: `DEMO${index.toString().padStart(3, '0')}`,
            brand: 'Demo',
            model: 'Moto de simulação',
            capacityUnits: 100,
            weightCapacityGrams: 20000,
            volumeCapacityCm3: 50000,
            compatibleCategories: [
              'HOT',
              'COLD',
              'FROZEN',
              'AMBIENT',
              'FRAGILE',
              'BEVERAGE',
              'MEDICINE',
              'OTHER',
            ],
          },
        });
        await tx.driverLocation.upsert({
          where: { driverId },
          update: {},
          create: {
            driverId,
            latitude: branch.latitude + (index % 3) * 0.0003,
            longitude: branch.longitude + (index % 2) * 0.0004,
            accuracy: 8,
            speed: 0,
            heading: 0,
            timestamp: now,
            expiresAt: new Date(now.getTime() + 90_000),
          },
        });
        await tx.wallet.upsert({
          where: { driverId },
          update: {},
          create: { id: id(7, index + 100), key: `driver:${driverId}`, type: 'DRIVER', driverId },
        });
        await tx.whatsAppIdentity.upsert({
          where: { id: id(8, index + 100) },
          update: {},
          create: {
            id: id(8, index + 100),
            phoneNumber: phone,
            entityType: 'DRIVER',
            entityId: driverId,
            verifiedAt: now,
            optInAt: now,
          },
        });
      }
      for (let index = 0; index < 20; index++) {
        const branchIndex = index % branches.length;
        const branch = branches[branchIndex];
        if (!branch) throw new Error('Missing seed branch');
        const deliveryId = id(9, index);
        const ready = index < 15;
        const pin = randomInt(0, 10_000).toString().padStart(4, '0');
        await tx.delivery.upsert({
          where: { id: deliveryId },
          update: {},
          create: {
            id: deliveryId,
            businessId: id(2, branch.business),
            branchId: id(3, branchIndex),
            externalReference: `orbita-demo-${index}`,
            customerName: `Cliente fictício ${index + 1}`,
            pickupLatitude: branch.latitude,
            pickupLongitude: branch.longitude,
            dropoffLatitude: branch.latitude + 0.003 + (index % 4) * 0.0006,
            dropoffLongitude: branch.longitude + 0.004 + (index % 5) * 0.0005,
            complement: 'Simulação — não realizar entrega real',
            items: [
              {
                name: branch.business === 2 ? 'Produto de demonstração' : 'Pedido de demonstração',
                quantity: 1,
              },
            ],
            status: 'WAITING_POOL',
            readinessStatus: ready ? 'READY_FOR_PICKUP' : 'PREPARING',
            serviceLevel: index % 3 === 0 ? 'ECONOMY' : index % 3 === 1 ? 'SMART' : 'EXPRESS',
            category: branch.business === 2 ? 'MEDICINE' : 'HOT',
            capacityUnits: 10,
            weightGrams: 1000,
            volumeCm3: 2000,
            readyAt: ready ? now : null,
            estimatedReadyAt: ready ? now : new Date(now.getTime() + 300_000),
            pickupDeadline: new Date(now.getTime() + 1_800_000),
            deliveryDeadline: new Date(now.getTime() + 3_600_000),
            maxDeliveryDurationSeconds: 2400,
            revenueCents: 700,
            verificationCodeHash: createHmac('sha256', pepper).update(`${deliveryId}:${pin}`).digest('hex'),
          },
        });
      }
      await tx.serviceZone.upsert({
        where: { id: id(10, 0) },
        update: {},
        create: {
          id: id(10, 0),
          name: 'Goiânia e Aparecida — demonstração',
          city: 'Goiânia/Aparecida de Goiânia',
        },
      });
      await tx.$executeRaw`
      UPDATE "ServiceZone" SET boundary = ST_Multi(ST_GeomFromText(
        'POLYGON((-49.40 -16.90,-49.10 -16.90,-49.10 -16.55,-49.40 -16.55,-49.40 -16.90))', 4326))
      WHERE id = ${id(10, 0)}::uuid AND boundary IS NULL`;
    },
    { timeout: 30_000 },
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Development seed cannot run in production');
  const password = process.env.SEED_PASSWORD;
  const pepper = process.env.PIN_PEPPER;
  if (!password || password.length < 12) throw new Error('Set SEED_PASSWORD with at least 12 characters');
  if (!pepper || pepper.length < 32) throw new Error('Set PIN_PEPPER with at least 32 characters');
  const prisma = new PrismaClient();
  try {
    await seed(prisma, await hashPassword(password), pepper);
    console.info(
      'Development seed ready: 3 businesses, 5 branches, 10 drivers, 20 deliveries. Existing records preserved. No messages sent.',
    );
    console.info(
      'Demo accounts: admin@orbita.example, business1..3@orbita.example, driver1..10@orbita.example. Password: SEED_PASSWORD.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed');
  process.exitCode = 1;
});
