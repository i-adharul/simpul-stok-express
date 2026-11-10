-- Creates (or refreshes) the database role of the demo reset script (ADR 0017).
-- Run it ONCE from a laptop as the postgres role, never on the server (ADR 0007):
--
--   psql "$POSTGRES_URL" -v reset_password="$RESET_PASSWORD" -f server/scripts/demoResetRole.sql
--
-- The password is a variable, so it is not in this file or in the shell history of the command line you type
-- if you export it first from a password manager. Run it again after a migration adds a table (grants are not
-- automatic), or to rotate the password. The role cannot create objects and owns nothing.
SELECT format('CREATE ROLE simpul_reset LOGIN PASSWORD %L', :'reset_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simpul_reset') \gexec

SELECT format('ALTER ROLE simpul_reset WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'reset_password') \gexec

GRANT USAGE ON SCHEMA public TO simpul_reset;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO simpul_reset;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO simpul_reset;

-- Check: the reset role may TRUNCATE and the application role may not.
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'StockMovements' AND grantee IN ('simpul_app', 'simpul_reset') ORDER BY grantee, privilege_type;
