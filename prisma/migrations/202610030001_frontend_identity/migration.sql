ALTER TABLE "User" ADD COLUMN "phone" TEXT, ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE "User" u SET "phone"=d.phone FROM "Driver" d WHERE d."userId"=u.id;
