-- Stage 1 masters: constraints Drizzle cannot express, search indexes, audit triggers, grants.
-- btree_gist and pg_trgm are trusted extensions, so erp_owner can create them.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- customers.salesman_id → salesmen (tables are defined in separate schema files).
ALTER TABLE customers ADD CONSTRAINT customers_salesman_id_salesmen_id_fk
  FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE SET NULL;
--> statement-breakpoint

-- Stage 1 gate: no two rates for the same customer + product may overlap in time.
-- A NULL valid_to is an open-ended range.
ALTER TABLE party_rates ADD CONSTRAINT party_rates_no_overlap
  EXCLUDE USING gist (
    customer_id WITH =,
    product_id WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  );
--> statement-breakpoint
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_no_overlap
  EXCLUDE USING gist (
    salesman_id WITH =,
    customer_id WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  );
--> statement-breakpoint

-- Trigram search (customers list, Ctrl K).
CREATE INDEX customers_search_trgm ON customers
  USING gin ((legal_name || ' ' || coalesce(trade_name, '') || ' ' || code || ' ' || coalesce(gstin, '') || ' ' || coalesce(phone, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX suppliers_search_trgm ON suppliers
  USING gin ((name || ' ' || code || ' ' || coalesce(gstin, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX transporters_search_trgm ON transporters
  USING gin ((name || ' ' || code || ' ' || coalesce(gstin, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX salesmen_search_trgm ON salesmen
  USING gin ((name || ' ' || code || ' ' || coalesce(phone, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX skus_code_trgm ON skus USING gin (code gin_trgm_ops);
--> statement-breakpoint

-- Audit triggers (CLAUDE.md rule 7).
CREATE TRIGGER audit_categories AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_qualities AFTER INSERT OR UPDATE OR DELETE ON qualities
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_products AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_skus AFTER INSERT OR UPDATE OR DELETE ON skus
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_suppliers AFTER INSERT OR UPDATE OR DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_transporters AFTER INSERT OR UPDATE OR DELETE ON transporters
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_customers AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_customer_contacts AFTER INSERT OR UPDATE OR DELETE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_customer_shipping_addresses AFTER INSERT OR UPDATE OR DELETE ON customer_shipping_addresses
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_customer_groups AFTER INSERT OR UPDATE OR DELETE ON customer_groups
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_customer_group_members AFTER INSERT OR UPDATE OR DELETE ON customer_group_members
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('customer_id', 'group_id');
--> statement-breakpoint
CREATE TRIGGER audit_credit_policies AFTER INSERT OR UPDATE OR DELETE ON credit_policies
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('customer_id');
--> statement-breakpoint
CREATE TRIGGER audit_party_rates AFTER INSERT OR UPDATE OR DELETE ON party_rates
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_salesmen AFTER INSERT OR UPDATE OR DELETE ON salesmen
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_salesman_default_rates AFTER INSERT OR UPDATE OR DELETE ON salesman_default_rates
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('salesman_id', 'product_id');
--> statement-breakpoint
CREATE TRIGGER audit_salesman_blocked_customers AFTER INSERT OR UPDATE OR DELETE ON salesman_blocked_customers
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('salesman_id', 'customer_id');
--> statement-breakpoint
CREATE TRIGGER audit_salesman_kyc_documents AFTER INSERT OR UPDATE OR DELETE ON salesman_kyc_documents
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint
CREATE TRIGGER audit_commission_rules AFTER INSERT OR UPDATE OR DELETE ON commission_rules
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('id');
--> statement-breakpoint

-- New tables inherit erp_app grants from the default privileges in 0001; history is append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON rate_history FROM erp_app;
