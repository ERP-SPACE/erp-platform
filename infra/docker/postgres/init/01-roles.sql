-- Local-only roles (ADR-0019, CLAUDE.md rule 7).
-- erp_owner owns the schema and runs migrations; erp_app is the runtime role used by api/worker.
-- Passwords here are for the local Docker database only.
CREATE ROLE erp_owner LOGIN PASSWORD 'erp_owner_dev';
CREATE ROLE erp_app LOGIN PASSWORD 'erp_app_dev';

ALTER DATABASE erp OWNER TO erp_owner;
GRANT CONNECT ON DATABASE erp TO erp_app;

\connect erp
ALTER SCHEMA public OWNER TO erp_owner;
GRANT USAGE ON SCHEMA public TO erp_app;
