-- Stage 5: reporting views (ADR-0005), refreshed CONCURRENTLY by the analytics job; audit on
-- saved pivots. Every money figure is taxable value (no GST, no round-off) unless named otherwise.

CREATE TRIGGER audit_saved_pivots AFTER INSERT OR UPDATE OR DELETE ON saved_pivots
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint

-- ── mv_sales_lines: one fact row per roll sold, per charge line, per returned roll, per note line ──
-- Revenue = posted SI taxable − credit notes + debit notes; COGS = landed cost of rolls billed −
-- cost of rolls returned (Q37). A goods line's taxable is split over its rolls by metres with
-- largest-remainder paise, so the rows of one line add up to the line exactly (ADR-0002).
-- Returns are taken from the return's rolls (they carry SKU and cost) and dated by the credit
-- note raised for them; other notes have no SKU. Customer group = the customer's first group by
-- code, so a pivot never counts a sale twice.

CREATE MATERIALIZED VIEW mv_sales_lines AS
WITH si_roll_split AS (
  SELECT sir.id AS si_roll_id, sir.si_line_id, sir.roll_id, sir.length_m, sir.cogs,
         l.taxable, l.discount + l.bill_discount AS discount,
         floor(l.taxable * 100 * sir.length_m / nullif(sum(sir.length_m) OVER w, 0)) AS base_paise,
         (l.taxable * 100 * sir.length_m / nullif(sum(sir.length_m) OVER w, 0))
           - floor(l.taxable * 100 * sir.length_m / nullif(sum(sir.length_m) OVER w, 0)) AS frac,
         (l.discount + l.bill_discount) * 100 * sir.length_m / nullif(sum(sir.length_m) OVER w, 0) AS disc_exact
  FROM sales_invoice_rolls sir
  JOIN sales_invoice_lines l ON l.id = sir.si_line_id
  WINDOW w AS (PARTITION BY sir.si_line_id)
),
si_roll_value AS (
  SELECT s.*,
         s.base_paise
           + CASE WHEN row_number() OVER (PARTITION BY s.si_line_id ORDER BY s.frac DESC, s.si_roll_id)
                       <= round(s.taxable * 100 - sum(s.base_paise) OVER (PARTITION BY s.si_line_id))
                  THEN 1 ELSE 0 END AS value_paise
  FROM si_roll_split s
),
facts AS (
  -- Goods sold, per roll
  SELECT 'SIR:' || v.si_roll_id AS fact_key, 'SI'::text AS doc_type, si.id AS doc_id, si.si_no AS doc_no,
         si.company_id, si.date, si.customer_id, si.salesman_id, l.sku_id, r.supplier_id, v.roll_id,
         v.length_m::numeric AS metres, 1 AS rolls,
         round(v.value_paise / 100.0, 2) AS value,
         round(v.disc_exact / 100.0, 2) AS discount,
         coalesce(v.cogs, 0) AS cogs, l.rate_per_m
  FROM si_roll_value v
  JOIN sales_invoice_lines l ON l.id = v.si_line_id
  JOIN sales_invoices si ON si.id = l.si_id
  JOIN rolls r ON r.id = v.roll_id
  WHERE si.status = 'Posted'
  UNION ALL
  -- Lines without rolls: charges (freight, packing) and any goods line billed without rolls
  SELECT 'SIL:' || l.id, 'SI', si.id, si.si_no, si.company_id, si.date, si.customer_id, si.salesman_id,
         l.sku_id, NULL, NULL, coalesce(l.metres, 0)::numeric, 0, l.taxable, l.discount + l.bill_discount,
         coalesce(l.cogs, 0), l.rate_per_m
  FROM sales_invoice_lines l
  JOIN sales_invoices si ON si.id = l.si_id
  WHERE si.status = 'Posted'
    AND NOT EXISTS (SELECT 1 FROM sales_invoice_rolls x WHERE x.si_line_id = l.id)
  UNION ALL
  -- Returned rolls, dated by their credit note
  SELECT 'SRR:' || srr.id, 'CN', n.id, n.note_no, n.company_id, n.date, n.customer_id, si.salesman_id,
         l.sku_id, r.supplier_id, srr.roll_id, -srr.returned_m::numeric, 0, -srr.taxable, 0,
         -coalesce(srr.cost, 0), l.rate_per_m
  FROM customer_notes n
  JOIN sales_returns sr ON sr.id = n.sales_return_id
  JOIN sales_return_rolls srr ON srr.return_id = sr.id
  JOIN sales_invoice_rolls sir ON sir.id = srr.si_roll_id
  JOIN sales_invoice_lines l ON l.id = sir.si_line_id
  JOIN sales_invoices si ON si.id = l.si_id
  JOIN rolls r ON r.id = srr.roll_id
  WHERE n.status = 'Posted' AND n.kind = 'CREDIT'
  UNION ALL
  -- Other credit / debit notes (rate difference, discount, shortage): value only, no SKU
  SELECT 'NL:' || nl.id, CASE n.kind WHEN 'CREDIT' THEN 'CN' ELSE 'DN' END, n.id, n.note_no,
         n.company_id, n.date, n.customer_id, si.salesman_id, NULL, NULL, NULL, 0, 0,
         CASE n.kind WHEN 'CREDIT' THEN -nl.taxable ELSE nl.taxable END, 0, 0, NULL
  FROM customer_notes n
  JOIN customer_note_lines nl ON nl.note_id = n.id
  LEFT JOIN sales_invoices si ON si.id = n.si_id
  WHERE n.status = 'Posted' AND n.sales_return_id IS NULL
)
SELECT f.*,
       f.value - f.cogs AS margin,
       c.legal_name AS customer_name,
       g.group_id AS customer_group_id,
       g.group_name AS customer_group_name,
       sm.name AS salesman_name,
       sk.code AS sku_code,
       cat.id AS category_id,
       cat.name AS category_name,
       p.gsm,
       q.name AS quality_name,
       sk.width_in,
       sup.name AS supplier_name,
       now() AS refreshed_at
FROM facts f
JOIN customers c ON c.id = f.customer_id
LEFT JOIN LATERAL (
  SELECT cg.id AS group_id, cg.name AS group_name
  FROM customer_group_members m JOIN customer_groups cg ON cg.id = m.group_id
  WHERE m.customer_id = f.customer_id
  ORDER BY cg.code LIMIT 1
) g ON true
LEFT JOIN salesmen sm ON sm.id = f.salesman_id
LEFT JOIN skus sk ON sk.id = f.sku_id
LEFT JOIN products p ON p.id = sk.product_id
LEFT JOIN categories cat ON cat.id = p.category_id
LEFT JOIN qualities q ON q.id = p.quality_id
LEFT JOIN suppliers sup ON sup.id = f.supplier_id;
--> statement-breakpoint
CREATE UNIQUE INDEX mv_sales_lines_uq ON mv_sales_lines (fact_key);
--> statement-breakpoint
CREATE INDEX mv_sales_lines_date_idx ON mv_sales_lines (company_id, date);
--> statement-breakpoint
CREATE INDEX mv_sales_lines_customer_idx ON mv_sales_lines (customer_id, date);
--> statement-breakpoint
CREATE INDEX mv_sales_lines_sku_idx ON mv_sales_lines (sku_id, date);
--> statement-breakpoint
CREATE INDEX mv_sales_lines_salesman_idx ON mv_sales_lines (salesman_id, date);
--> statement-breakpoint

-- ── mv_stock_aging: one row per roll in stock, with its age and last movement ──
-- Age runs from the GRN; the last movement is the latest of receipt, mapping, any status change
-- and any length change (cut, correction, return). Feeds batch aging, dead stock and the heatmap.

CREATE MATERIALIZED VIEW mv_stock_aging AS
SELECT r.id AS roll_id, r.company_id, r.barcode, r.status::text AS status, r.sku_id, r.supplier_id,
       r.batch_id, r.description, r.gsm, r.width_in, r.quality_name, r.current_length_m AS metres,
       round(r.current_length_m * coalesce(r.cost_per_m, r.base_cost_per_m, 0), 2) AS value,
       r.received_at,
       greatest(r.received_at, r.mapped_at, st.last_at, lc.last_at) AS last_moved_at,
       (current_date - (r.received_at AT TIME ZONE 'Asia/Kolkata')::date) AS age_days,
       (current_date - (greatest(r.received_at, r.mapped_at, st.last_at, lc.last_at) AT TIME ZONE 'Asia/Kolkata')::date)
         AS idle_days,
       sup.name AS supplier_name,
       sk.code AS sku_code,
       now() AS refreshed_at
FROM rolls r
LEFT JOIN LATERAL (
  SELECT max(t.at) AS last_at FROM status_transitions t
  WHERE t.entity_type = 'Roll' AND t.entity_id = r.id
) st ON true
LEFT JOIN LATERAL (
  SELECT max(x.created_at) AS last_at FROM roll_length_changes x WHERE x.roll_id = r.id
) lc ON true
LEFT JOIN suppliers sup ON sup.id = r.supplier_id
LEFT JOIN skus sk ON sk.id = r.sku_id
WHERE r.status IN ('Unmapped', 'Mapped', 'Allocated');
--> statement-breakpoint
CREATE UNIQUE INDEX mv_stock_aging_uq ON mv_stock_aging (roll_id);
--> statement-breakpoint
CREATE INDEX mv_stock_aging_age_idx ON mv_stock_aging (company_id, age_days);
--> statement-breakpoint
CREATE INDEX mv_stock_aging_idle_idx ON mv_stock_aging (company_id, idle_days);
--> statement-breakpoint
-- Status history is read per roll by the view above.
CREATE INDEX IF NOT EXISTS status_transitions_entity_at_idx
  ON status_transitions (entity_type, entity_id, at);
--> statement-breakpoint

-- ── mv_purchase_lines: ordered vs received vs invoiced per PO line, lead time and rejections ──

CREATE MATERIALIZED VIEW mv_purchase_lines AS
SELECT pol.id AS po_line_id, po.company_id, po.id AS po_id, po.po_no, po.date AS po_date,
       po.status::text AS po_status, po.supplier_id, sup.name AS supplier_name,
       pol.sku_id, pol.description, pol.quantity_m AS ordered_m, pol.received_m, pol.invoiced_m,
       pol.quantity_m - pol.received_m AS short_m,
       pol.received_m - pol.invoiced_m AS uninvoiced_m,
       coalesce(g.rejected_m, 0) AS rejected_m,
       coalesce(g.accepted_rolls, 0) AS accepted_rolls,
       coalesce(g.rejected_rolls, 0) AS rejected_rolls,
       po.approved_at,
       g.first_grn_at,
       CASE WHEN po.approved_at IS NOT NULL AND g.first_grn_at IS NOT NULL
            THEN round(extract(epoch FROM g.first_grn_at - po.approved_at) / 86400.0, 1) END AS lead_days,
       now() AS refreshed_at
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.po_id
JOIN suppliers sup ON sup.id = po.supplier_id
LEFT JOIN LATERAL (
  SELECT sum(gl.rejected_m) AS rejected_m, sum(gl.roll_count) AS accepted_rolls,
         sum(gl.rejected_count) AS rejected_rolls, min(grn.posted_at) AS first_grn_at
  FROM goods_receipt_lines gl
  JOIN goods_receipts grn ON grn.id = gl.grn_id
  WHERE gl.po_line_id = pol.id AND grn.status = 'Posted'
) g ON true
WHERE po.status <> 'Draft';
--> statement-breakpoint
CREATE UNIQUE INDEX mv_purchase_lines_uq ON mv_purchase_lines (po_line_id);
--> statement-breakpoint
CREATE INDEX mv_purchase_lines_supplier_idx ON mv_purchase_lines (supplier_id, po_date);
--> statement-breakpoint

-- ── mv_landed_cost_monthly: average landed cost per metre by SKU, supplier and month received ──
-- Weighted by original length; rolls whose landed cost is not yet known use the base cost.

CREATE MATERIALIZED VIEW mv_landed_cost_monthly AS
SELECT r.company_id, r.sku_id, r.supplier_id,
       to_char(r.received_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month,
       count(*)::int AS rolls,
       sum(r.original_length_m)::bigint AS metres,
       round(sum(r.original_length_m * coalesce(r.cost_per_m, r.base_cost_per_m, 0))
             / nullif(sum(r.original_length_m), 0), 4) AS avg_cost_per_m,
       bool_and(r.cost_per_m IS NOT NULL) AS landed_known,
       min(sk.code) AS sku_code,
       min(sup.name) AS supplier_name,
       now() AS refreshed_at
FROM rolls r
JOIN skus sk ON sk.id = r.sku_id
JOIN suppliers sup ON sup.id = r.supplier_id
WHERE r.parent_roll_id IS NULL
GROUP BY r.company_id, r.sku_id, r.supplier_id, month;
--> statement-breakpoint
CREATE UNIQUE INDEX mv_landed_cost_monthly_uq
  ON mv_landed_cost_monthly (company_id, sku_id, supplier_id, month);
--> statement-breakpoint

-- ── mv_scrap: value written off — rolls scrapped (at their length and cost then) and cut waste ──

CREATE MATERIALIZED VIEW mv_scrap AS
SELECT 'R:' || r.id AS scrap_key, r.company_id, 'ROLL'::text AS kind, r.id AS roll_id, r.barcode,
       r.sku_id, r.supplier_id, (t.at AT TIME ZONE 'Asia/Kolkata')::date AS date, t.reason,
       r.current_length_m AS metres,
       round(r.current_length_m * coalesce(r.cost_per_m, r.base_cost_per_m, 0), 2) AS value,
       now() AS refreshed_at
FROM rolls r
JOIN LATERAL (
  SELECT x.at, x.reason FROM status_transitions x
  WHERE x.entity_type = 'Roll' AND x.entity_id = r.id AND x.to_status = 'Scrap'
  ORDER BY x.at DESC LIMIT 1
) t ON true
WHERE r.status = 'Scrap'
UNION ALL
SELECT 'C:' || c.id, r.company_id, 'CUT_WASTE', r.id, r.barcode, r.sku_id, r.supplier_id,
       (c.created_at AT TIME ZONE 'Asia/Kolkata')::date, c.reason, c.waste_m, c.waste_cost, now()
FROM roll_cuts c
JOIN rolls r ON r.id = c.parent_roll_id
WHERE c.waste_m > 0;
--> statement-breakpoint
CREATE UNIQUE INDEX mv_scrap_uq ON mv_scrap (scrap_key);
--> statement-breakpoint

-- ── mv_dso_monthly: credit sales and closing receivables per month, for DSO ──
-- Sales here include GST (receivables do too); receivables are the customer ledger balance at
-- month end. Months run from the first document to the current month.

CREATE MATERIALIZED VIEW mv_dso_monthly AS
WITH bounds AS (
  SELECT company_id, date_trunc('month', min(date))::date AS first_month
  FROM v_customer_ledger GROUP BY company_id
),
months AS (
  SELECT b.company_id, m::date AS month_start,
         (m + interval '1 month' - interval '1 day')::date AS month_end
  FROM bounds b,
       generate_series(b.first_month, date_trunc('month', current_date), interval '1 month') m
)
SELECT m.company_id, to_char(m.month_start, 'YYYY-MM') AS month, m.month_start, m.month_end,
       (m.month_end - m.month_start + 1) AS days,
       coalesce((
         SELECT sum(l.debit) FILTER (WHERE l.doc_type IN ('SI', 'DN'))
              - coalesce(sum(l.credit) FILTER (WHERE l.doc_type = 'CN'), 0)
         FROM v_customer_ledger l
         WHERE l.company_id = m.company_id AND l.date BETWEEN m.month_start AND m.month_end
       ), 0) AS sales,
       coalesce((
         SELECT sum(l.debit - l.credit) FROM v_customer_ledger l
         WHERE l.company_id = m.company_id AND l.date <= m.month_end
       ), 0) AS closing_receivables,
       now() AS refreshed_at
FROM months m;
--> statement-breakpoint
CREATE UNIQUE INDEX mv_dso_monthly_uq ON mv_dso_monthly (company_id, month);
--> statement-breakpoint

GRANT SELECT ON mv_sales_lines, mv_stock_aging, mv_purchase_lines, mv_landed_cost_monthly,
  mv_scrap, mv_dso_monthly TO erp_app;
--> statement-breakpoint

-- Only the owner may refresh a materialized view; the worker (erp_app) calls this instead.
CREATE FUNCTION public.refresh_report_views() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sales_lines;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_stock_aging;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_purchase_lines;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_landed_cost_monthly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_scrap;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dso_monthly;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.refresh_report_views() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.refresh_report_views() TO erp_app;
