ALTER TABLE accounts
  ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'));
--> statement-breakpoint
ALTER TABLE transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('POSTED', 'PENDING', 'REVERSED'));
--> statement-breakpoint
ALTER TABLE postings
  ADD CONSTRAINT postings_direction_check
  CHECK (direction IN ('DEBIT', 'CREDIT'));
--> statement-breakpoint
ALTER TABLE postings
  ADD CONSTRAINT postings_amount_check
  CHECK (amount > 0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_ledger_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger rows are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_no_update
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();
--> statement-breakpoint
CREATE TRIGGER transactions_no_delete
BEFORE DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();
--> statement-breakpoint
CREATE TRIGGER postings_no_update
BEFORE UPDATE ON postings
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();
--> statement-breakpoint
CREATE TRIGGER postings_no_delete
BEFORE DELETE ON postings
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();
