-- Stage 2: audit triggers, append-only grants and stock materialized views (ADR-0005).

-- Audit triggers (CLAUDE.md rule 7).
CREATE TRIGGER audit_batches AFTER INSERT OR UPDATE OR DELETE ON batches
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_purchase_orders AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_purchase_order_lines AFTER INSERT OR UPDATE OR DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_goods_receipts AFTER INSERT OR UPDATE OR DELETE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_goods_receipt_lines AFTER INSERT OR UPDATE OR DELETE ON goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_purchase_invoices AFTER INSERT OR UPDATE OR DELETE ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_purchase_invoice_lines AFTER INSERT OR UPDATE OR DELETE ON purchase_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_purchase_invoice_grns AFTER INSERT OR UPDATE OR DELETE ON purchase_invoice_grns
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('pi_id', 'grn_id');
--> statement-breakpoint
CREATE TRIGGER audit_landed_cost_charges AFTER INSERT OR UPDATE OR DELETE ON landed_cost_charges
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_rolls AFTER INSERT OR UPDATE OR DELETE ON rolls
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_purchase_returns AFTER INSERT OR UPDATE OR DELETE ON purchase_returns
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_purchase_return_rolls AFTER INSERT OR UPDATE OR DELETE ON purchase_return_rolls
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
-- label_prints and landed_cost_allocations are append-only ledgers of their own; they are not
-- audited row by row (the allocation run and the print are audited through their parents).

-- Append-only for the runtime role.
REVOKE UPDATE, DELETE, TRUNCATE ON label_prints, landed_cost_allocations FROM erp_app;
--> statement-breakpoint

-- Search rolls by barcode fragment or description (Roll Inspector, /floor).
CREATE INDEX rolls_search_trgm ON rolls USING gin ((barcode || ' ' || description) gin_trgm_ops);
--> statement-breakpoint

-- ── Stock materialized views, refreshed every 3 min in business hours (ADR-0005) ──
-- In stock = Unmapped, Mapped, Allocated. Value uses the full cost per metre once landed cost
-- is known, else the base cost per metre (provisional from the PO, then the PI).

CREATE MATERIALIZED VIEW mv_stock_by_sku AS
SELECT
  r.company_id,
  coalesce(r.sku_id::text, 'U:' || r.description || '|' || r.gsm || '|' || r.width_in) AS stock_key,
  r.sku_id,
  min(r.description) AS description,
  r.gsm,
  r.width_in,
  count(*)::int AS rolls,
  sum(r.current_length_m)::bigint AS metres,
  sum(round(r.current_length_m * coalesce(r.cost_per_m, r.base_cost_per_m, 0), 2)) AS value,
  count(*) FILTER (WHERE r.status = 'Unmapped')::int AS unmapped_rolls,
  min(r.received_at) AS oldest_received_at,
  now() AS refreshed_at
FROM rolls r
WHERE r.status IN ('Unmapped', 'Mapped', 'Allocated')
GROUP BY r.company_id, stock_key, r.sku_id, r.gsm, r.width_in;
--> statement-breakpoint
CREATE UNIQUE INDEX mv_stock_by_sku_uq ON mv_stock_by_sku (company_id, stock_key);
--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_stock_by_batch AS
SELECT
  r.company_id,
  r.batch_id,
  r.supplier_id,
  min(b.batch_seq) AS batch_seq,
  min(b.supplier_batch_ref) AS supplier_batch_ref,
  count(*)::int AS rolls,
  sum(r.current_length_m)::bigint AS metres,
  sum(round(r.current_length_m * coalesce(r.cost_per_m, r.base_cost_per_m, 0), 2)) AS value,
  min(r.received_at) AS oldest_received_at,
  now() AS refreshed_at
FROM rolls r
JOIN batches b ON b.id = r.batch_id
WHERE r.status IN ('Unmapped', 'Mapped', 'Allocated')
GROUP BY r.company_id, r.batch_id, r.supplier_id;
--> statement-breakpoint
CREATE UNIQUE INDEX mv_stock_by_batch_uq ON mv_stock_by_batch (batch_id);
--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_stock_by_supplier AS
SELECT
  r.company_id,
  r.supplier_id,
  count(*)::int AS rolls,
  sum(r.current_length_m)::bigint AS metres,
  sum(round(r.current_length_m * coalesce(r.cost_per_m, r.base_cost_per_m, 0), 2)) AS value,
  count(*) FILTER (WHERE r.status = 'Unmapped')::int AS unmapped_rolls,
  min(r.received_at) AS oldest_received_at,
  now() AS refreshed_at
FROM rolls r
WHERE r.status IN ('Unmapped', 'Mapped', 'Allocated')
GROUP BY r.company_id, r.supplier_id;
--> statement-breakpoint
CREATE UNIQUE INDEX mv_stock_by_supplier_uq ON mv_stock_by_supplier (company_id, supplier_id);
--> statement-breakpoint

GRANT SELECT ON mv_stock_by_sku, mv_stock_by_batch, mv_stock_by_supplier TO erp_app;
--> statement-breakpoint

-- Only the owner may refresh a materialized view; the worker (erp_app) calls this instead.
CREATE FUNCTION public.refresh_stock_views() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stock_by_sku;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stock_by_batch;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stock_by_supplier;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refresh_stock_views() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.refresh_stock_views() TO erp_app;
