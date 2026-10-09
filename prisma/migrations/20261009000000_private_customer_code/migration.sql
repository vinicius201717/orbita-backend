-- Private recovery is additive. Existing deliveries recover lazily through the authorized endpoint.
ALTER TABLE "Delivery" ADD COLUMN "customerCodeCiphertext" TEXT;
