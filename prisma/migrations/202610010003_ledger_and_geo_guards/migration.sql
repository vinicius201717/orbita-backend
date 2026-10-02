-- A transaction with no entries must not bypass the deferred balance check.
CREATE FUNCTION orbita_ledger_header_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT; entries BIGINT;
BEGIN
  SELECT COALESCE(SUM("amountCents"),0),COUNT(*) INTO total,entries FROM "WalletTransaction" WHERE "ledgerTransactionId"=NEW.id;
  IF total<>0 OR entries<2 THEN RAISE EXCEPTION 'Unbalanced or empty ledger transaction'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_header_balance AFTER INSERT ON "LedgerTransaction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orbita_ledger_header_balance();
ALTER TABLE "RouteStop" ADD CONSTRAINT stop_coordinates CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE "LocationHistory" ADD CONSTRAINT history_coordinates CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE "Driver" ADD CONSTRAINT driver_load_nonnegative CHECK ("currentCapacityUnits">=0 AND "maxCapacityUnits">0);
ALTER TABLE "RouteOffer" ADD CONSTRAINT offer_financial_consistency CHECK ("offeredPayoutCents">=0 AND "revenueCents">=0 AND "platformMarginCents"="revenueCents"-"offeredPayoutCents");
