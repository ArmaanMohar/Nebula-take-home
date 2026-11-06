---
name: data-audit
description: Profile an orders.csv + kit_events.csv pair and report every anomaly before any decisions or code changes. Use at project start and whenever a new CSV pair is introduced.
---

# Data Audit

Goal: find every rough edge in the data so I can make explicit decisions. **Report only — do not change app code.**

## Inputs

Paths to `orders.csv` and `kit_events.csv` (default: `public/sample/`).

## Steps

1. Write a throwaway Node/TS script in `scripts/audit.ts`. If `src/lib/parse.ts` exists, use it so the audit matches app behavior; otherwise parse with Papaparse directly.
2. For each file, report:
   - Row count, column list (as given and normalized), unexpected/missing columns
   - Null/blank count per column
   - Distinct values + counts for categorical columns (`product`, `status`, `country`, `is_test`, `event_type`, `source`), including near-duplicates by case/whitespace
   - Timestamp formats detected (with examples), timezone offsets present, unparseable values, min/max
3. Cross-file checks:
   - Events whose `order_id` is not in orders
   - Paid, non-upload_only orders with zero events
   - `upload_only` orders that DO have kit events
   - Kits-per-order distribution; kit_ids shared across orders
   - Exact duplicate events; same (kit, event_type) at different times
   - Out-of-order sequences per kit vs the pipeline in `config.ts`
   - Events before order `created_at` or after the max timestamp
   - Kits with both `qc_passed` and `qc_failed`
   - `kit_replaced` events with/without a following new kit; new kits with no predecessor
   - Test, refunded and cancelled orders that still have pipeline activity
4. Proposed `asOf` (max valid `occurred_at`).

## Output

- Write `docs/data-audit.md` with one table per section and 1–3 example rows per anomaly.
- End with **"Decisions needed"**: every anomaly not already covered by the Data decisions table in `CLAUDE.md`, each with 2–3 options and a recommendation.
- Summarize the top findings to me in ≤ 10 bullets. Do not apply any decision yourself.
