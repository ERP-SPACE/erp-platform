-- Salesman rate history and commission change log (ported from legacy agent tracking)

CREATE TABLE salesman_rate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id uuid NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  previous_rate_44 numeric(12, 4),
  new_rate_44 numeric(12, 4),
  change_type text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text REFERENCES "user"(id)
);

CREATE INDEX salesman_rate_history_salesman_idx ON salesman_rate_history(salesman_id, created_at DESC);
CREATE INDEX salesman_rate_history_product_idx ON salesman_rate_history(salesman_id, product_id);

COMMENT ON TABLE salesman_rate_history IS 'History of salesman default rate changes for the Rate History feature.';

CREATE TABLE commission_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_id uuid NOT NULL REFERENCES salesmen(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES commission_rules(id) ON DELETE SET NULL,
  change_type text NOT NULL,
  previous_method commission_method,
  previous_rate numeric(12, 4),
  previous_trigger commission_trigger,
  new_method commission_method,
  new_rate numeric(12, 4),
  new_trigger commission_trigger,
  valid_from date,
  valid_to date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text REFERENCES "user"(id)
);

CREATE INDEX commission_change_log_salesman_idx ON commission_change_log(salesman_id, created_at DESC);
CREATE INDEX commission_change_log_customer_idx ON commission_change_log(customer_id);

COMMENT ON TABLE commission_change_log IS 'Commission rule change log for the Commission Change Log feature.';

-- Grant access to the app role
GRANT SELECT, INSERT ON salesman_rate_history TO erp_app;
GRANT SELECT, INSERT ON commission_change_log TO erp_app;
