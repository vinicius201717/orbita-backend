-- Coordinates stay synchronized even when written outside the API.
CREATE FUNCTION orbita_point_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude),4326)::geography;
  RETURN NEW;
END $$;
CREATE TRIGGER branch_point BEFORE INSERT OR UPDATE OF latitude,longitude ON "BusinessBranch" FOR EACH ROW EXECUTE FUNCTION orbita_point_sync();
CREATE TRIGGER driver_point BEFORE INSERT OR UPDATE OF latitude,longitude ON "DriverLocation" FOR EACH ROW EXECUTE FUNCTION orbita_point_sync();
CREATE TRIGGER stop_point BEFORE INSERT OR UPDATE OF latitude,longitude ON "RouteStop" FOR EACH ROW EXECUTE FUNCTION orbita_point_sync();
CREATE FUNCTION orbita_delivery_points() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."pickupLocation" := ST_SetSRID(ST_MakePoint(NEW."pickupLongitude",NEW."pickupLatitude"),4326)::geography;
  NEW."dropoffLocation" := ST_SetSRID(ST_MakePoint(NEW."dropoffLongitude",NEW."dropoffLatitude"),4326)::geography;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_points BEFORE INSERT OR UPDATE OF "pickupLatitude","pickupLongitude","dropoffLatitude","dropoffLongitude" ON "Delivery" FOR EACH ROW EXECUTE FUNCTION orbita_delivery_points();
CREATE INDEX branch_location_gist ON "BusinessBranch" USING GIST(location);
CREATE INDEX driver_location_gist ON "DriverLocation" USING GIST(location);
CREATE INDEX stop_location_gist ON "RouteStop" USING GIST(location);
CREATE INDEX delivery_pickup_gist ON "Delivery" USING GIST("pickupLocation");
CREATE INDEX delivery_dropoff_gist ON "Delivery" USING GIST("dropoffLocation");
CREATE INDEX zone_boundary_gist ON "ServiceZone" USING GIST(boundary);
CREATE UNIQUE INDEX one_active_vehicle_per_driver ON "Vehicle"("driverId") WHERE active;
CREATE UNIQUE INDEX one_live_route_per_driver ON "Route"("driverId") WHERE status IN ('BUILDING','OFFERING','ASSIGNED','ACTIVE');
ALTER TABLE "Driver" ADD CONSTRAINT current_route_fk FOREIGN KEY ("currentRouteId") REFERENCES "Route"(id);
ALTER TABLE "Delivery" ADD CONSTRAINT delivery_positive_money CHECK ("revenueCents">=0 AND "driverPayoutCents">=0 AND "tipCents">=0);
ALTER TABLE "Delivery" ADD CONSTRAINT delivery_positive_capacity CHECK ("capacityUnits">0 AND ("weightGrams" IS NULL OR "weightGrams">=0) AND ("volumeCm3" IS NULL OR "volumeCm3">=0));
ALTER TABLE "Delivery" ADD CONSTRAINT delivery_sla CHECK ("deliveryDeadline">="pickupDeadline" AND "maxDeliveryDurationSeconds">0);
ALTER TABLE "Delivery" ADD CONSTRAINT delivery_coordinates CHECK ("pickupLatitude" BETWEEN -90 AND 90 AND "dropoffLatitude" BETWEEN -90 AND 90 AND "pickupLongitude" BETWEEN -180 AND 180 AND "dropoffLongitude" BETWEEN -180 AND 180);
ALTER TABLE "BusinessBranch" ADD CONSTRAINT branch_coordinates CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE "DriverLocation" ADD CONSTRAINT driver_coordinates CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE "Vehicle" ADD CONSTRAINT vehicle_positive_capacity CHECK ("capacityUnits">0);
ALTER TABLE "Route" ADD CONSTRAINT route_positive_version CHECK (version>0);
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_owner CHECK ((type='DRIVER' AND "driverId" IS NOT NULL AND "businessId" IS NULL) OR (type='BUSINESS' AND "businessId" IS NOT NULL AND "driverId" IS NULL) OR (type='PLATFORM' AND "driverId" IS NULL AND "businessId" IS NULL));
-- Ledger entries are immutable. Corrections require a compensating transaction.
CREATE FUNCTION orbita_immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Ledger is append-only'; END $$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON "WalletTransaction" FOR EACH ROW EXECUTE FUNCTION orbita_immutable_ledger();
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON "LedgerTransaction" FOR EACH ROW EXECUTE FUNCTION orbita_immutable_ledger();
CREATE FUNCTION orbita_balanced_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT; entries BIGINT;
BEGIN
  SELECT COALESCE(SUM("amountCents"),0),COUNT(*) INTO total,entries FROM "WalletTransaction" WHERE "ledgerTransactionId"=NEW."ledgerTransactionId";
  IF total<>0 OR entries<2 THEN RAISE EXCEPTION 'Unbalanced ledger transaction'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balance AFTER INSERT ON "WalletTransaction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orbita_balanced_ledger();
