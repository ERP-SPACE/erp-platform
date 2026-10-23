import { sql } from "drizzle-orm";
import {
  bigserial,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdOnly, id } from "./columns.js";
import { branches, companies } from "./tenancy.js";

/** Every status change of every entity (CLAUDE.md rule 3). Append-only for erp_app. */
export const statusTransitions = pgTable(
  "status_transitions",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    requestId: text("request_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    by: text("by"),
  },
  (t) => [index("status_transitions_entity_idx").on(t.entityType, t.entityId, t.at)],
);

/** Stored responses for Idempotency-Key replays (CLAUDE.md rule 6). */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    method: text("method").notNull(),
    route: text("route").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index("idempotency_expires_idx").on(t.expiresAt)],
);

/**
 * Posting events outbox (ADR-0004). Written in the same transaction as each financial document;
 * consumed and back-filled by the accounting stage. Append-only for erp_app.
 */
export const postingEvents = pgTable(
  "posting_events",
  {
    id: id(),
    seq: bigserial("seq", { mode: "number" }).notNull().unique(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    type: text("type").notNull(),
    docType: text("doc_type").notNull(),
    docId: uuid("doc_id").notNull(),
    docNo: text("doc_no"),
    docDate: date("doc_date").notNull(),
    partyType: text("party_type"),
    partyId: uuid("party_id"),
    payload: jsonb("payload").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    requestId: text("request_id"),
    ...createdOnly,
  },
  (t) => [index("posting_events_doc_idx").on(t.docType, t.docId)],
);

export const notificationChannel = pgEnum("notification_channel", ["in_app", "email", "whatsapp"]);
export const notificationStatus = pgEnum("notification_status", ["pending", "sent", "failed", "read"]);

/** Notification outbox; WhatsApp becomes another channel adapter later (brief §A7). */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    channel: notificationChannel("channel").notNull(),
    recipientUserId: text("recipient_user_id"),
    recipientAddress: text("recipient_address"),
    template: text("template").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientUserId, t.status),
    index("notifications_pending_idx").on(t.status, t.createdAt),
  ],
);
