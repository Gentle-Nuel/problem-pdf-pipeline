-- Fixes "permission denied for table X": disabling "Automatically expose
-- new tables" during project setup (correctly, to keep anon/authenticated
-- out) also skipped granting privileges to service_role, which our
-- functions actually use. RLS was never the issue — service_role bypasses
-- RLS by default; it just never had table grants in the first place.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

-- Applies the same grant automatically to any table created after this,
-- so future migrations don't hit the same error.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
