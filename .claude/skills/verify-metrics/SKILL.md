---
name: verify-metrics
description: Independently recompute key dashboard metrics from the raw CSVs and diff them against the app's src/lib output. Run in a fresh subagent that has not written the app code.
---

# Verify Metrics (independent check)

You are a reviewer. You did not write this code. Your job is to catch wrong numbers, **not to fix them**.

## Rules

- Read `CLAUDE.md` for the data decisions and stuck definition. They are the spec.
- **Do NOT import anything from `src/lib`** for the independent calculation. Write a standalone script in `scripts/verify/recompute.ts` that reads the raw CSVs and applies the decisions from the spec yourself.
- Then separately call the app's `src/lib` functions on the same data with no filters and the same `asOf`.

## Metrics to compare

1. `asOf` value
2. Total orders, kit orders, upload_only orders, test orders excluded
3. Kit count by current stage (incl. completed, replaced)
4. Median and p90 days per stage, per product (30x vs 100x), with n
5. % over target per stage
6. Stuck kit count, total and by owner; list of stuck kit_ids
7. Data quality counts per exclusion/flag reason
8. Two hand-traced orders: pick one with a replacement and one with a flagged event; walk through every event and state the expected kit states

## Known traps to check explicitly

- Wall-clock date used instead of `asOf`
- Replaced kits counted as stuck or as in-progress
- Test / refunded / cancelled orders leaking into duration or stuck stats
- upload_only orders appearing in the funnel or stuck list
- Timezone offsets shifting a duration across a day
- Duplicate events double-counting a stage
- First vs last occurrence of repeated events
- Filters (product/country/date) not applied to one of the views

## Output

A table: metric | independent value | app value | match? Then a list of mismatches with the likely cause and the file/function to look at. Do not edit `src/`.
