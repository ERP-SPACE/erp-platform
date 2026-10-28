-- Stage 4: audit triggers, append-only rules and the customer / supplier ledgers with receipts.

-- Audit triggers (CLAUDE.md rule 7).
CREATE TRIGGER audit_receipts AFTER INSERT OR UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_allocations AFTER INSERT OR UPDATE OR DELETE ON allocations
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_commission_entries AFTER INSERT OR UPDATE OR DELETE ON commission_entries
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_commission_payouts AFTER INSERT OR UPDATE OR DELETE ON commission_payouts
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
-- Settlements and commission are history: reversals add or stamp rows, nothing is deleted.
REVOKE DELETE, TRUNCATE ON allocations, commission_entries FROM erp_app;
--> statement-breakpoint

-- Customer sub-ledger (ADR-0016), now with receipts: invoices and debit notes owe; credit notes,
-- receipts and TDS deducted by the customer (Q32) reduce; a reversed receipt adds back.
DROP VIEW v_customer_ledger;
--> statement-breakpoint
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
WHERE n.status = 'Posted'
UNION ALL
SELECT r.company_id, r.customer_id, r.date, NULL::date, 'RC', r.id, r.doc_no, 0, r.amount, r.posted_at
FROM receipts r
WHERE r.party_type = 'CUSTOMER' AND r.status IN ('Posted', 'Reversed')
UNION ALL
SELECT r.company_id, r.customer_id, (r.reversed_at AT TIME ZONE 'Asia/Kolkata')::date, NULL::date, 'REV',
       r.id, r.doc_no, r.amount, 0, r.reversed_at
FROM receipts r
WHERE r.party_type = 'CUSTOMER' AND r.status = 'Reversed'
UNION ALL
SELECT a.company_id, si.customer_id, a.date, NULL::date, 'TDS', a.id, si.si_no, 0, a.deduction, a.created_at
FROM allocations a
JOIN sales_invoices si ON si.id = a.sales_invoice_id
WHERE a.deduction > 0 AND a.reversed_at IS NULL;
--> statement-breakpoint
GRANT SELECT ON v_customer_ledger TO erp_app;
--> statement-breakpoint

-- Supplier sub-ledger: posted purchase invoices are owed (credit); payments, purchase-return
-- debit notes and TDS we deduct reduce it (debit); a reversed payment adds back.
CREATE VIEW v_supplier_ledger AS
SELECT pi.company_id, pi.supplier_id, pi.supplier_invoice_date AS date,
       (pi.supplier_invoice_date + s.payment_days) AS due_date, 'PI'::text AS doc_type,
       pi.id AS doc_id, coalesce(pi.supplier_invoice_no, pi.pi_no) AS doc_no,
       0::numeric(14,2) AS debit, pi.total AS credit, pi.posted_at
FROM purchase_invoices pi
JOIN suppliers s ON s.id = pi.supplier_id
WHERE pi.status = 'Posted'
UNION ALL
SELECT pr.company_id, pr.supplier_id, pr.date, NULL::date, 'DN', pr.id, pr.dn_no, pr.total, 0, pr.posted_at
FROM purchase_returns pr
WHERE pr.status = 'Posted'
UNION ALL
SELECT r.company_id, r.supplier_id, r.date, NULL::date, 'PY', r.id, r.doc_no, r.amount, 0, r.posted_at
FROM receipts r
WHERE r.party_type = 'SUPPLIER' AND r.status IN ('Posted', 'Reversed')
UNION ALL
SELECT r.company_id, r.supplier_id, (r.reversed_at AT TIME ZONE 'Asia/Kolkata')::date, NULL::date, 'REV',
       r.id, r.doc_no, 0, r.amount, r.reversed_at
FROM receipts r
WHERE r.party_type = 'SUPPLIER' AND r.status = 'Reversed'
UNION ALL
SELECT a.company_id, pi.supplier_id, a.date, NULL::date, 'TDS', a.id, coalesce(pi.supplier_invoice_no, pi.pi_no),
       a.deduction, 0, a.created_at
FROM allocations a
JOIN purchase_invoices pi ON pi.id = a.purchase_invoice_id
WHERE a.deduction > 0 AND a.reversed_at IS NULL;
--> statement-breakpoint
GRANT SELECT ON v_supplier_ledger TO erp_app;
--> statement-breakpoint

-- Open invoices for allocation and aging.
CREATE INDEX sales_invoices_open_idx ON sales_invoices (customer_id, due_date) WHERE status = 'Posted';
--> statement-breakpoint
CREATE INDEX purchase_invoices_open_idx ON purchase_invoices (supplier_id, supplier_invoice_date)
  WHERE status = 'Posted';
