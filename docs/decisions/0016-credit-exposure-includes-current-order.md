# 0016 — Credit exposure at confirm includes the order being confirmed

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
PRD: `exposure = outstanding AR + value of Confirmed/PartiallyFulfilled SOs`; block if exposure > limit. Read literally, the order being confirmed is excluded, so a customer at 99% of their limit could confirm a huge order. The legacy build included the current order.

## Decision
- **Rule:** at confirm, block if `outstanding AR + other open SO value (unfulfilled portion) + this SO value > credit_limit` (OVER_LIMIT).
- **OVER_DUE:** any posted SI unpaid beyond `credit_days + grace_days`.
- **Auto-block:** applies only when `auto_block = true`. A manual block flag always applies.
- **Outstanding AR:** comes from the sub-ledger (invoices − allocated receipts − credit notes − opening balances).
- **Performance:** must answer in under 1 s. Indexed queries suffice at this scale; no cached exposure column.
