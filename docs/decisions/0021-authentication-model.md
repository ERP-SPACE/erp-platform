# 0021 — Authentication model

- **Status:** Accepted
- **Date:** 2026-10-23

## Decision
- **Sign-in:** email + password through **Better Auth** (session cookie: httpOnly, SameSite=Strict, Secure outside localhost; argon2id-class hashing).
- **No public sign-up.** Users are created only by Owner/Admin, from Settings › Users.
- **TOTP two-factor:** required for the **Owner** role (enrolment is forced at first login) and optional for everyone else.
- **Step-up re-auth:**
  - Sensitive actions require that the user authenticated within `STEP_UP_SECONDS` (default 300). This uses Better Auth's session `freshAge`.
  - The API returns `401 STEP_UP_REQUIRED`. The web app shows a password (+ TOTP) dialog and retries.
  - Sensitive actions: credit override, over-tolerance rate override, reversals, go-live lock, user/role/permission changes, document-series edits.
- **Authorisation is ours, not Better Auth's:**
  - `roles`, `permissions` (codes like `settings.series.update`), `role_permissions`, `user_roles`, and `user_scopes` (customer group / product family / own customers).
  - Permissions are checked by a NestJS guard. Scopes are applied in repository queries from Stage 1 onward.
- **Seeded roles (PRD §4.1):** Owner, Admin, Purchase Manager, Sales Manager, Sales Executive, Warehouse, Accountant.
