CREATE TABLE "Document" (
 "id" UUID NOT NULL, "entityType" TEXT NOT NULL, "entityId" UUID NOT NULL, "type" TEXT NOT NULL,
 "fileName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL,
 "storageKey" TEXT NOT NULL, "sha256" TEXT NOT NULL, "status" "OnboardingStatus" NOT NULL DEFAULT 'PENDING',
 "uploadedById" UUID NOT NULL, "replacesId" UUID, "expiresAt" TIMESTAMPTZ(3),
 "reviewNotes" TEXT, "reviewedById" UUID, "reviewedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Document_pkey" PRIMARY KEY ("id"), CONSTRAINT "Document_entityType_check" CHECK ("entityType" IN ('BUSINESS','DRIVER'))
);
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");
CREATE INDEX "Document_entityType_entityId_createdAt_idx" ON "Document"("entityType","entityId","createdAt");
