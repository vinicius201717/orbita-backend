CREATE TABLE "MerchantProduct" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "available" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "MerchantProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantProduct_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantProduct_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "MerchantProduct_category_check" CHECK (length(btrim("category")) BETWEEN 1 AND 60),
  CONSTRAINT "MerchantProduct_description_check" CHECK ("description" IS NULL OR length("description") <= 500),
  CONSTRAINT "MerchantProduct_price_check" CHECK ("priceCents" BETWEEN 1 AND 10000000)
);
CREATE INDEX "MerchantProduct_businessId_name_idx" ON "MerchantProduct"("businessId", "name");

CREATE TABLE "MerchantOrder" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "customerPhone" TEXT,
  "address" TEXT NOT NULL,
  "notes" TEXT,
  "totalCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "BusinessBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantOrder_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantOrder_total_check" CHECK ("totalCents" BETWEEN 1 AND 2000000000),
  CONSTRAINT "MerchantOrder_address_check" CHECK (length(btrim("address")) BETWEEN 1 AND 500)
);
CREATE UNIQUE INDEX "MerchantOrder_deliveryId_key" ON "MerchantOrder"("deliveryId");
CREATE UNIQUE INDEX "MerchantOrder_businessId_idempotencyKey_key" ON "MerchantOrder"("businessId", "idempotencyKey");
CREATE INDEX "MerchantOrder_businessId_createdAt_id_idx" ON "MerchantOrder"("businessId", "createdAt", "id");

CREATE TABLE "MerchantOrderItem" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  CONSTRAINT "MerchantOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MerchantOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "MerchantProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MerchantOrderItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100),
  CONSTRAINT "MerchantOrderItem_price_check" CHECK ("unitPriceCents" BETWEEN 1 AND 10000000),
  CONSTRAINT "MerchantOrderItem_total_check" CHECK ("totalCents" = "unitPriceCents" * "quantity")
);
CREATE UNIQUE INDEX "MerchantOrderItem_orderId_position_key" ON "MerchantOrderItem"("orderId", "position");
CREATE UNIQUE INDEX "MerchantOrderItem_orderId_productId_key" ON "MerchantOrderItem"("orderId", "productId");
