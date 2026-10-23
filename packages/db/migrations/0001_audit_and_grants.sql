-- Audit log, partitions, triggers and runtime-role grants (CLAUDE.md rule 7, ADR-0021).
-- Runs as erp_owner. erp_app (the API/worker role) can read the audit log but never write it
-- directly: rows only arrive through the SECURITY DEFINER trigger function.

CREATE SCHEMA IF NOT EXISTS audit;
--> statement-breakpoint
CREATE TABLE audit.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  row_id text,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  before jsonb,
  after jsonb,
  changed_keys text[],
  user_id text,
  request_id text,
  reason text,
  company_id uuid,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
--> statement-breakpoint
CREATE TABLE audit.audit_log_default PARTITION OF audit.audit_log DEFAULT;
--> statement-breakpoint
CREATE INDEX audit_log_row_idx ON audit.audit_log (table_name, row_id, at DESC);
--> statement-breakpoint
CREATE INDEX audit_log_user_idx ON audit.audit_log (user_id, at DESC);
--> statement-breakpoint
CREATE INDEX audit_log_at_idx ON audit.audit_log (at DESC);
--> statement-breakpoint

-- Secrets never reach the audit log (key list ported from erp_api/middlewares/auditMiddleware.js).
CREATE FUNCTION audit.redact(doc jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT doc - ARRAY['password', 'token', 'secret', 'backup_codes', 'access_token',
                     'refresh_token', 'id_token', 'api_key', 'otp', 'pin']
$$;
--> statement-breakpoint

-- Generic row trigger. TG_ARGV lists the column(s) that identify the row.
-- Context comes from SET LOCAL app.* values set by the API's UnitOfWork.
CREATE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = audit, public, pg_temp AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_changed text[];
  v_row_id text := '';
  v_company uuid;
  i int;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN v_before := audit.redact(to_jsonb(OLD)); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN v_after := audit.redact(to_jsonb(NEW)); END IF;
  v_row := coalesce(v_after, v_before);

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(key ORDER BY key) INTO v_changed
    FROM jsonb_each(v_after)
    WHERE v_before -> key IS DISTINCT FROM value
      AND key NOT IN ('updated_at', 'updated_by', 'version');
    IF v_changed IS NULL THEN
      RETURN NULL; -- bookkeeping-only update: nothing worth auditing
    END IF;
  END IF;

  FOR i IN 0 .. TG_NARGS - 1 LOOP
    v_row_id := v_row_id || CASE WHEN i > 0 THEN ':' ELSE '' END || coalesce(v_row ->> TG_ARGV[i], '');
  END LOOP;

  v_company := coalesce(
    (v_row ->> 'company_id')::uuid,
    nullif(current_setting('app.company_id', true), '')::uuid
  );

  INSERT INTO audit.audit_log
    (table_name, row_id, action, before, after, changed_keys, user_id, request_id, reason, company_id)
  VALUES (
    TG_TABLE_NAME, v_row_id, TG_OP, v_before, v_after, v_changed,
    nullif(current_setting('app.user_id', true), ''),
    nullif(current_setting('app.request_id', true), ''),
    nullif(current_setting('app.reason', true), ''),
    v_company
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Monthly partitions (IST month boundaries). Called here and daily by the worker.
CREATE FUNCTION audit.ensure_partitions(months_ahead int DEFAULT 2) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = audit, pg_temp AS $$
DECLARE
  v_month date := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_from timestamptz;
  v_to timestamptz;
  v_name text;
  v_created int := 0;
BEGIN
  FOR i IN 0 .. months_ahead LOOP
    v_name := format('audit_log_%s', to_char(v_month, 'YYYYMM'));
    IF to_regclass(format('audit.%I', v_name)) IS NULL THEN
      v_from := v_month::timestamp AT TIME ZONE 'Asia/Kolkata';
      v_to := (v_month + interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata';
      EXECUTE format(
        'CREATE TABLE audit.%I PARTITION OF audit.audit_log FOR VALUES FROM (%L) TO (%L)',
        v_name, v_from, v_to
      );
      v_created := v_created + 1;
    END IF;
    v_month := (v_month + interval '1 month')::date;
  END LOOP;
  RETURN v_created;
END;
$$;
--> statement-breakpoint
SELECT audit.ensure_partitions(2);
--> statement-breakpoint

CREATE TRIGGER audit_companies AFTER INSERT OR UPDATE OR DELETE ON companies
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_branches AFTER INSERT OR UPDATE OR DELETE ON branches
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_user AFTER INSERT OR UPDATE OR DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_roles AFTER INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_role_permissions AFTER INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('role_id', 'permission_code');
--> statement-breakpoint
CREATE TRIGGER audit_user_roles AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('user_id', 'role_id');
--> statement-breakpoint
CREATE TRIGGER audit_user_scopes AFTER INSERT OR UPDATE OR DELETE ON user_scopes
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_settings AFTER INSERT OR UPDATE OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('key');
--> statement-breakpoint
CREATE TRIGGER audit_document_series AFTER INSERT OR UPDATE OR DELETE ON document_series
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint

-- Runtime role grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE erp_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO erp_app;
--> statement-breakpoint
-- Append-only tables: history can be added to, never rewritten.
REVOKE UPDATE, DELETE, TRUNCATE ON status_transitions, posting_events FROM erp_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA audit TO erp_app;
--> statement-breakpoint
GRANT SELECT ON audit.audit_log TO erp_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit.ensure_partitions(int) TO erp_app;
