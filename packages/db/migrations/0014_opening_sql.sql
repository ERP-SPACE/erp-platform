-- Stage 6: Go-Live lock (PRD §5.10, Q44), audit on the opening tables, audit archival (Q45).

CREATE TRIGGER audit_opening_batches AFTER INSERT OR UPDATE OR DELETE ON opening_batches
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_opening_chapters AFTER INSERT OR UPDATE OR DELETE ON opening_chapters
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('company_id', 'chapter');
--> statement-breakpoint
CREATE TRIGGER audit_opening_cash_balances AFTER INSERT OR UPDATE OR DELETE ON opening_cash_balances
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_go_live AFTER INSERT OR UPDATE OR DELETE ON go_live
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('company_id');
--> statement-breakpoint
-- Live is permanent for the application (the database owner can still undo it in an emergency).
REVOKE UPDATE, DELETE, TRUNCATE ON go_live FROM erp_app;
--> statement-breakpoint

-- ── the lock ─────────────────────────────────────────────────────────────────

CREATE FUNCTION public.golive_locked_at(p_company uuid) RETURNS timestamptz
  LANGUAGE sql STABLE AS $$ SELECT locked_at FROM go_live WHERE company_id = p_company $$;
--> statement-breakpoint

-- Opening batches, chapters and bank balances are read-only once live.
CREATE FUNCTION public.opening_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_company uuid := coalesce((to_jsonb(NEW) ->> 'company_id')::uuid, (to_jsonb(OLD) ->> 'company_id')::uuid);
BEGIN
  IF golive_locked_at(v_company) IS NOT NULL THEN
    RAISE EXCEPTION 'OPENING_LOCKED: opening balances are locked since go-live; correct them with an adjustment and a reason'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER opening_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_batches
  FOR EACH ROW EXECUTE FUNCTION opening_guard();
--> statement-breakpoint
CREATE TRIGGER opening_chapters_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_chapters
  FOR EACH ROW EXECUTE FUNCTION opening_guard();
--> statement-breakpoint
CREATE TRIGGER opening_cash_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_cash_balances
  FOR EACH ROW EXECUTE FUNCTION opening_guard();
--> statement-breakpoint

-- Opening GRNs and opening invoices: none added or removed once live, and their amounts, dates
-- and parties never change after it (payments and notes against them still work).
CREATE FUNCTION public.opening_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_row jsonb := coalesce(v_new, v_old);
BEGIN
  IF v_row ->> 'opening_batch_id' IS NULL OR golive_locked_at((v_row ->> 'company_id')::uuid) IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP <> 'UPDATE'
     OR v_new -> 'total' IS DISTINCT FROM v_old -> 'total'
     OR v_new -> 'date' IS DISTINCT FROM v_old -> 'date'
     OR v_new -> 'due_date' IS DISTINCT FROM v_old -> 'due_date'
     OR v_new -> 'supplier_invoice_date' IS DISTINCT FROM v_old -> 'supplier_invoice_date'
     OR v_new -> 'customer_id' IS DISTINCT FROM v_old -> 'customer_id'
     OR v_new -> 'supplier_id' IS DISTINCT FROM v_old -> 'supplier_id'
     OR v_new -> 'status' IS DISTINCT FROM v_old -> 'status'
     OR v_new -> 'opening_batch_id' IS DISTINCT FROM v_old -> 'opening_batch_id' THEN
    RAISE EXCEPTION 'OPENING_LOCKED: opening documents are locked since go-live; correct them with a note or adjustment and a reason'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goods_receipts_opening_guard BEFORE INSERT OR UPDATE OR DELETE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION opening_document_guard();
--> statement-breakpoint
CREATE TRIGGER sales_invoices_opening_guard BEFORE INSERT OR UPDATE OR DELETE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION opening_document_guard();
--> statement-breakpoint
CREATE TRIGGER purchase_invoices_opening_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION opening_document_guard();
--> statement-breakpoint

-- The first live posting dated on or after the go-live date locks the wizard (PRD §5.10).
-- Nothing locks until a go-live date is set, so trial postings during UAT don't.
-- Trigger arguments: document type, document-number column, date column.
CREATE FUNCTION public.golive_on_post() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_company uuid := (v_new ->> 'company_id')::uuid;
  v_golive date;
BEGIN
  IF v_new ->> 'status' <> 'Posted'
     OR (TG_OP = 'UPDATE' AND to_jsonb(OLD) ->> 'status' = 'Posted')
     OR v_new ->> 'opening_batch_id' IS NOT NULL
     OR golive_locked_at(v_company) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT nullif(value #>> '{}', '')::date INTO v_golive
    FROM settings WHERE company_id = v_company AND key = 'golive.date';
  IF v_golive IS NULL OR (v_new ->> TG_ARGV[2])::date < v_golive THEN
    RETURN NULL;
  END IF;
  INSERT INTO go_live (company_id, locked_by_doc)
  VALUES (v_company, TG_ARGV[0] || ' ' || coalesce(v_new ->> TG_ARGV[1], (v_new ->> 'id')))
  ON CONFLICT (company_id) DO NOTHING;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER goods_receipts_golive AFTER INSERT OR UPDATE OF status ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION golive_on_post('GRN', 'grn_no', 'date');
--> statement-breakpoint
CREATE TRIGGER purchase_invoices_golive AFTER INSERT OR UPDATE OF status ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION golive_on_post('PI', 'pi_no', 'supplier_invoice_date');
--> statement-breakpoint
CREATE TRIGGER sales_invoices_golive AFTER INSERT OR UPDATE OF status ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION golive_on_post('SI', 'si_no', 'date');
--> statement-breakpoint
CREATE TRIGGER customer_notes_golive AFTER INSERT OR UPDATE OF status ON customer_notes
  FOR EACH ROW EXECUTE FUNCTION golive_on_post('NOTE', 'note_no', 'date');
--> statement-breakpoint
CREATE TRIGGER receipts_golive AFTER INSERT OR UPDATE OF status ON receipts
  FOR EACH ROW EXECUTE FUNCTION golive_on_post('RC/PY', 'doc_no', 'date');
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.golive_on_post() FROM PUBLIC;
--> statement-breakpoint

-- ── audit archival (Q45) ─────────────────────────────────────────────────────
-- Monthly partitions older than N months are detached from audit.audit_log and moved to the
-- audit_archive schema: still queryable, never deleted before the 7-year retention (rule 7).
-- The worker writes each archived month to storage as compressed CSV first.

CREATE SCHEMA IF NOT EXISTS audit_archive;
--> statement-breakpoint
GRANT USAGE ON SCHEMA audit_archive TO erp_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA audit_archive GRANT SELECT ON TABLES TO erp_app;
--> statement-breakpoint

-- Partitions due for archiving (the worker exports these first).
CREATE FUNCTION audit.partitions_to_archive(older_than_months int) RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = audit, pg_temp AS $$
  SELECT c.relname::text
  FROM pg_inherits i
  JOIN pg_class c ON c.oid = i.inhrelid
  JOIN pg_class p ON p.oid = i.inhparent
  JOIN pg_namespace n ON n.oid = p.relnamespace
  WHERE n.nspname = 'audit' AND p.relname = 'audit_log'
    AND c.relname ~ '^audit_log_[0-9]{6}$'
    AND to_date(right(c.relname, 6), 'YYYYMM')
        < (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - make_interval(months => older_than_months))::date
  ORDER BY 1
$$;
--> statement-breakpoint

CREATE FUNCTION audit.archive_partition(p_name text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = audit, pg_temp AS $$
BEGIN
  IF p_name !~ '^audit_log_[0-9]{6}$' THEN
    RAISE EXCEPTION 'Not an audit partition: %', p_name;
  END IF;
  EXECUTE format('ALTER TABLE audit.audit_log DETACH PARTITION audit.%I', p_name);
  EXECUTE format('ALTER TABLE audit.%I SET SCHEMA audit_archive', p_name);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_archive.%I FROM PUBLIC, erp_app', p_name);
  EXECUTE format('GRANT SELECT ON audit_archive.%I TO erp_app', p_name);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit.partitions_to_archive(int), audit.archive_partition(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit.partitions_to_archive(int), audit.archive_partition(text) TO erp_app;
