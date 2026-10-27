-- Stage 3: audit triggers, append-only grants and the customer ledger view.

-- Audit triggers (CLAUDE.md rule 7).
CREATE TRIGGER audit_sales_orders AFTER INSERT OR UPDATE OR DELETE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_sales_order_lines AFTER INSERT OR UPDATE OR DELETE ON sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_delivery_challans AFTER INSERT OR UPDATE OR DELETE ON delivery_challans
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_delivery_challan_rolls AFTER INSERT OR UPDATE OR DELETE ON delivery_challan_rolls
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_roll_cuts AFTER INSERT OR UPDATE OR DELETE ON roll_cuts
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_proformas AFTER INSERT OR UPDATE OR DELETE ON proformas
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_proforma_lines AFTER INSERT OR UPDATE OR DELETE ON proforma_lines
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_sales_invoices AFTER INSERT OR UPDATE OR DELETE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_sales_invoice_lines AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_sales_invoice_rolls AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_rolls
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_sales_returns AFTER INSERT OR UPDATE OR DELETE ON sales_returns
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_sales_return_rolls AFTER INSERT OR UPDATE OR DELETE ON sales_return_rolls
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_customer_notes AFTER INSERT OR UPDATE OR DELETE ON customer_notes
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_customer_note_lines AFTER INSERT OR UPDATE OR DELETE ON customer_note_lines
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_sales_invoice_dcs AFTER INSERT OR UPDATE OR DELETE ON sales_invoice_dcs
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('si_id', 'dc_id');
--> statement-breakpoint
-- roll_length_changes and einvoice_requests are append-only logs of their own.
REVOKE UPDATE, DELETE, TRUNCATE ON roll_length_changes, einvoice_requests FROM erp_app;
--> statement-breakpoint

-- Customer sub-ledger (ADR-0016): posted invoices and debit notes owe; credit notes reduce.
-- Receipts and opening balances join this view in Stages 4 and 6.
CREATE VIEW v_customer_ledger AS
SELECT si.company_id, si.customer_id, si.date, si.due_date, 'SI'::text AS doc_type, si.id AS doc_id,
       si.si_no AS doc_no, si.total AS debit, 0::numeric(14,2) AS credit, si.posted_at
FROM sales_invoices si
WHERE si.status = 'Posted'
UNION ALL
SELECT n.company_id, n.customer_id, n.date, NULL::date, CASE n.kind WHEN 'CREDIT' THEN 'CN' ELSE 'DN' END,
       n.id, n.note_no,
       CASE n.kind WHEN 'DEBIT' THEN n.total ELSE 0 END,
       CASE n.kind WHEN 'CREDIT' THEN n.total ELSE 0 END,
       n.posted_at
FROM customer_notes n
WHERE n.status = 'Posted';
--> statement-breakpoint
GRANT SELECT ON v_customer_ledger TO erp_app;
--> statement-breakpoint

-- Open orders by customer feed the credit check (Confirmed / PartiallyFulfilled only — OnHold
-- never counts, PRD §7). Undelivered value = line amount × undelivered share.
CREATE INDEX sales_orders_exposure_idx ON sales_orders (customer_id)
  WHERE status IN ('Confirmed', 'PartiallyFulfilled');
