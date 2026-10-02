CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'BUSINESS_OWNER', 'BUSINESS_STAFF', 'DRIVER');

-- CreateEnum
CREATE TYPE "BusinessCategory" AS ENUM ('FOOD', 'PHARMACY', 'BEVERAGE_DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('OFFLINE', 'AVAILABLE', 'ON_ROUTE', 'PAUSED');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('MOTORCYCLE', 'CAR', 'UTILITY', 'VAN');

-- CreateEnum
CREATE TYPE "CargoCategory" AS ENUM ('HOT', 'COLD', 'FROZEN', 'AMBIENT', 'FRAGILE', 'BEVERAGE', 'MEDICINE', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryServiceLevel" AS ENUM ('ECONOMY', 'SMART', 'EXPRESS');

-- CreateEnum
CREATE TYPE "ReadinessStatus" AS ENUM ('PREPARING', 'READY_FOR_PICKUP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('CREATED', 'WAITING_POOL', 'MATCHING', 'OFFERED', 'ASSIGNED', 'PICKUP_PENDING', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVING', 'DELIVERED', 'FAILED', 'CANCELLED', 'RETURN_REQUIRED', 'RETURNING', 'RETURNED');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('BUILDING', 'OFFERING', 'ASSIGNED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "StopType" AS ENUM ('PICKUP', 'DROPOFF');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'ARRIVED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('INSERTION', 'NEW_ROUTE');

-- CreateEnum
CREATE TYPE "ProofMethod" AS ENUM ('PIN', 'CUSTOMER_CONFIRMATION', 'PHOTO', 'ADMIN');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('CUSTOMER_UNAVAILABLE', 'WRONG_ADDRESS', 'BUSINESS_DELAY', 'PRODUCT_DAMAGED', 'DRIVER_BREAKDOWN', 'ACCIDENT', 'CUSTOMER_REFUSED', 'OTHER');

-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('DRIVER', 'BUSINESS', 'PLATFORM');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DELIVERY_EARNING', 'BONUS', 'TIP', 'ADJUSTMENT', 'PAYOUT', 'REFUND', 'CHARGE');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('PREPAID', 'POSTPAID');

-- CreateEnum
CREATE TYPE "IdentityType" AS ENUM ('BUSINESS', 'DRIVER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "businessId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "category" "BusinessCategory" NOT NULL DEFAULT 'FOOD',
    "billingMode" "BillingMode" NOT NULL DEFAULT 'POSTPAID',
    "businessReadyScore" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessBranch" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326),
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'OFFLINE',
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "rating" INTEGER NOT NULL DEFAULT 500,
    "reliabilityScore" INTEGER NOT NULL DEFAULT 100,
    "maxCapacityUnits" INTEGER NOT NULL DEFAULT 100,
    "currentCapacityUnits" INTEGER NOT NULL DEFAULT 0,
    "acceptNewOrders" BOOLEAN NOT NULL DEFAULT true,
    "currentRouteId" UUID,
    "lastLocationAt" TIMESTAMPTZ(3),
    "locationConsentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "VehicleType" NOT NULL DEFAULT 'MOTORCYCLE',
    "plate" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "capacityUnits" INTEGER NOT NULL DEFAULT 100,
    "weightCapacityGrams" INTEGER,
    "volumeCapacityCm3" INTEGER,
    "compatibleCategories" "CargoCategory"[] DEFAULT ARRAY[]::"CargoCategory"[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverDocument" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverLocation" (
    "driverId" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326),
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriverLocation_pkey" PRIMARY KEY ("driverId")
);

-- CreateTable
CREATE TABLE "LocationHistory" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "routeId" UUID,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LocationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "driverId" UUID,
    "routeId" UUID,
    "externalReference" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerOptInAt" TIMESTAMPTZ(3),
    "pickupLatitude" DOUBLE PRECISION NOT NULL,
    "pickupLongitude" DOUBLE PRECISION NOT NULL,
    "pickupLocation" geography(Point,4326),
    "dropoffLatitude" DOUBLE PRECISION NOT NULL,
    "dropoffLongitude" DOUBLE PRECISION NOT NULL,
    "dropoffLocation" geography(Point,4326),
    "complement" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "status" "DeliveryStatus" NOT NULL DEFAULT 'WAITING_POOL',
    "readinessStatus" "ReadinessStatus" NOT NULL DEFAULT 'PREPARING',
    "serviceLevel" "DeliveryServiceLevel" NOT NULL DEFAULT 'SMART',
    "category" "CargoCategory" NOT NULL DEFAULT 'AMBIENT',
    "capacityUnits" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "volumeCm3" INTEGER,
    "temperatureRequirement" TEXT,
    "packageType" TEXT,
    "readyAt" TIMESTAMPTZ(3),
    "estimatedReadyAt" TIMESTAMPTZ(3),
    "pickupDeadline" TIMESTAMPTZ(3) NOT NULL,
    "deliveryDeadline" TIMESTAMPTZ(3) NOT NULL,
    "maxDeliveryDurationSeconds" INTEGER NOT NULL,
    "pickedUpAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "pickupWaitTimeSeconds" INTEGER,
    "revenueCents" INTEGER NOT NULL,
    "driverPayoutCents" INTEGER NOT NULL DEFAULT 0,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "verificationCodeHash" TEXT NOT NULL,
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),
    "customerConfirmationTokenHash" TEXT,
    "confirmationExpiresAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'ASSIGNED',
    "estimatedDistanceMeters" INTEGER NOT NULL DEFAULT 0,
    "estimatedDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "grossValueCents" INTEGER NOT NULL DEFAULT 0,
    "driverPayoutCents" INTEGER NOT NULL DEFAULT 0,
    "platformMarginCents" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "type" "StopType" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326),
    "estimatedArrivalAt" TIMESTAMPTZ(3),
    "arrivedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteOffer" (
    "id" UUID NOT NULL,
    "routeId" UUID,
    "driverId" UUID NOT NULL,
    "offerType" "OfferType" NOT NULL,
    "expectedRouteVersion" INTEGER,
    "additionalDistanceMeters" INTEGER NOT NULL,
    "additionalDurationSeconds" INTEGER NOT NULL,
    "offeredPayoutCents" INTEGER NOT NULL,
    "revenueCents" INTEGER NOT NULL,
    "platformMarginCents" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "respondedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferDelivery" (
    "offerId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,

    CONSTRAINT "OfferDelivery_pkey" PRIMARY KEY ("offerId","deliveryId")
);

-- CreateTable
CREATE TABLE "DeliveryProof" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "method" "ProofMethod" NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "photoUrl" TEXT,
    "recipientName" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "DeliveryProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryIncident" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "type" "IncidentType" NOT NULL,
    "notes" TEXT,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" UUID NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitFee" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "waitSeconds" INTEGER NOT NULL,
    "billableSeconds" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" UUID NOT NULL,
    "type" "WalletType" NOT NULL,
    "key" TEXT NOT NULL,
    "driverId" UUID,
    "businessId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "ledgerTransactionId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverEarning" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "payoutCents" INTEGER NOT NULL,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppIdentity" (
    "id" UUID NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "entityType" "IdentityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "optInAt" TIMESTAMPTZ(3),
    "lastInboundAt" TIMESTAMPTZ(3),

    CONSTRAINT "WhatsAppIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSession" (
    "id" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppInbox" (
    "id" UUID NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WhatsAppInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageOutbox" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudFlag" (
    "id" UUID NOT NULL,
    "driverId" UUID,
    "deliveryId" UUID,
    "type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceZone" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "pricingMultiplierBps" INTEGER NOT NULL DEFAULT 10000,
    "boundary" geometry(MultiPolygon,4326),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_businessId_idx" ON "User"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_familyId_idx" ON "RefreshToken"("userId", "familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Business_document_key" ON "Business"("document");

-- CreateIndex
CREATE UNIQUE INDEX "Business_phone_key" ON "Business"("phone");

-- CreateIndex
CREATE INDEX "BusinessBranch_businessId_idx" ON "BusinessBranch"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_phone_key" ON "Driver"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_currentRouteId_key" ON "Driver"("currentRouteId");

-- CreateIndex
CREATE INDEX "Driver_status_onboardingStatus_idx" ON "Driver"("status", "onboardingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate");

-- CreateIndex
CREATE INDEX "Vehicle_driverId_active_idx" ON "Vehicle"("driverId", "active");

-- CreateIndex
CREATE INDEX "DriverDocument_driverId_idx" ON "DriverDocument"("driverId");

-- CreateIndex
CREATE INDEX "DriverLocation_expiresAt_idx" ON "DriverLocation"("expiresAt");

-- CreateIndex
CREATE INDEX "LocationHistory_driverId_timestamp_idx" ON "LocationHistory"("driverId", "timestamp");

-- CreateIndex
CREATE INDEX "LocationHistory_timestamp_idx" ON "LocationHistory"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_customerConfirmationTokenHash_key" ON "Delivery"("customerConfirmationTokenHash");

-- CreateIndex
CREATE INDEX "Delivery_status_readinessStatus_createdAt_idx" ON "Delivery"("status", "readinessStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Delivery_branchId_createdAt_idx" ON "Delivery"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Delivery_businessId_createdAt_idx" ON "Delivery"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Delivery_driverId_idx" ON "Delivery"("driverId");

-- CreateIndex
CREATE INDEX "Delivery_routeId_idx" ON "Delivery"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_businessId_externalReference_key" ON "Delivery"("businessId", "externalReference");

-- CreateIndex
CREATE INDEX "Route_driverId_status_idx" ON "Route"("driverId", "status");

-- CreateIndex
CREATE INDEX "Route_status_idx" ON "Route"("status");

-- CreateIndex
CREATE INDEX "RouteStop_deliveryId_idx" ON "RouteStop"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_routeId_sequence_key" ON "RouteStop"("routeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_routeId_deliveryId_type_key" ON "RouteStop"("routeId", "deliveryId", "type");

-- CreateIndex
CREATE INDEX "RouteOffer_driverId_status_idx" ON "RouteOffer"("driverId", "status");

-- CreateIndex
CREATE INDEX "RouteOffer_status_expiresAt_idx" ON "RouteOffer"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RouteOffer_routeId_idx" ON "RouteOffer"("routeId");

-- CreateIndex
CREATE INDEX "OfferDelivery_deliveryId_idx" ON "OfferDelivery"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryProof_deliveryId_key" ON "DeliveryProof"("deliveryId");

-- CreateIndex
CREATE INDEX "DeliveryIncident_deliveryId_idx" ON "DeliveryIncident"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "WaitFee_deliveryId_key" ON "WaitFee"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_key_key" ON "Wallet"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_driverId_key" ON "Wallet"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_businessId_key" ON "Wallet"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_ledgerTransactionId_idx" ON "WalletTransaction"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverEarning_deliveryId_key" ON "DriverEarning"("deliveryId");

-- CreateIndex
CREATE INDEX "DriverEarning_driverId_createdAt_idx" ON "DriverEarning"("driverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppIdentity_phoneNumber_key" ON "WhatsAppIdentity"("phoneNumber");

-- CreateIndex
CREATE INDEX "WhatsAppIdentity_entityType_entityId_idx" ON "WhatsAppIdentity"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationSession_identityId_key" ON "ConversationSession"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInbox_externalMessageId_key" ON "WhatsAppInbox"("externalMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppInbox_status_receivedAt_idx" ON "WhatsAppInbox"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageOutbox_idempotencyKey_key" ON "MessageOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MessageOutbox_status_nextAttemptAt_idx" ON "MessageOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_availableAt_idx" ON "OutboxEvent"("processedAt", "availableAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_purpose_idx" ON "ConsentRecord"("userId", "purpose");

-- CreateIndex
CREATE INDEX "FraudFlag_driverId_createdAt_idx" ON "FraudFlag"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_status_idx" ON "PrivacyRequest"("status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessBranch" ADD CONSTRAINT "BusinessBranch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLocation" ADD CONSTRAINT "DriverLocation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationHistory" ADD CONSTRAINT "LocationHistory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "BusinessBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteOffer" ADD CONSTRAINT "RouteOffer_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteOffer" ADD CONSTRAINT "RouteOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferDelivery" ADD CONSTRAINT "OfferDelivery_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "RouteOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferDelivery" ADD CONSTRAINT "OfferDelivery_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProof" ADD CONSTRAINT "DeliveryProof_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryIncident" ADD CONSTRAINT "DeliveryIncident_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitFee" ADD CONSTRAINT "WaitFee_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverEarning" ADD CONSTRAINT "DriverEarning_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "WhatsAppIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

