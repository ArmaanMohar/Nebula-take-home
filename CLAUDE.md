# Kit Lifecycle Dashboard — Project Rules

## Context

- Take-home challenge for Nebula Genomics (challenge.html). Hard timebox: 2 hours total.
- Static, client-side web app for an ops team: pipeline overview, stage durations by product, stuck kits, order drill-down, filters, CSV upload.
- Reviewers will upload THEIR OWN orders.csv + kit_events.csv (same columns, possibly messier). The app must never crash on upload. Handle errors gracefully.
- Priority of work: correct numbers & core tests > robust parsing > usable stuck-kit workflow > visual polish.

## Stack (do not change without asking)

- Vite + React + TypeScript (`strict: true`), Tailwind, Papaparse, Recharts, Vitest.
- Static deploy (netlify). No backend, no database, no auth, no SSR.
- Do not add any dependency without asking me first.

## Layout

```
src/lib/            pure data logic — NO React imports
  types.ts          Order, KitEvent, Kit, DataQualityReport, ExclusionReason
  config.ts         pipeline order, stage targets, stage owners
  parse.ts          CSV → typed rows (header normalization, tolerant parsing)
  clean.ts          normalization, dedupe, exclusions, flags
  kits.ts           derive per-kit timeline, current stage, replacement links
  metrics.ts        funnel, durations (median/p90/% over target), stuck list
  __tests__/        Vitest tests
  __tests__/fixtures/  tiny hand-written CSVs, one per rule
src/views/          Overview, Durations, Stuck, OrderDetail, DataQuality
src/components/     presentational only
src/state/          filters (synced to URL query params), loaded dataset
public/sample/      default orders.csv + kit_events.csv
scripts/            throwaway analysis/verification scripts
AI_NOTES.md         running log of AI mistakes (see Workflow)
```

## Hard rules — data

1. **No wall-clock time in analysis.** Never use `Date.now()` / `new Date()` for metrics. `asOf` = max `occurred_at` across valid events (fallback: max `created_at`). The UI always shows "Data as of <asOf>".
2. **Never silently drop a row.** Every exclusion goes through one function, `exclude(row, reason)`, that records into `DataQualityReport`. Reasons are a typed enum. Every flag (kept but suspicious) goes through `flag(row, reason)`.
3. **Single source of truth for the pipeline.** Stage order, targets and owners live only in `config.ts`. No hard-coded day counts anywhere else. Avoid Magic numbers.
4. **Time:** parse all timestamps to UTC. Durations are calendar days as fractional numbers; round only at display (1 decimal).
5. **Layering:** single responsiblity -> components never compute metrics; they call selectors from `src/lib`. `src/lib` is pure and deterministic given (data, filters, asOf).
6. **Tolerant parser:** handle BOM, CRLF, blank lines, quoted fields, header case/whitespace, reordered or extra columns. A missing required column produces a clear UI error message, never a crash or blank screen.
7. **Unknown values** (event_type, product, status, source): trim + lowercase first; if still unrecognized → flag and exclude from pipeline math, don't throw.
8. If you hit a data case not covered by the decisions below, **stop and ask me** with 2–3 options. Do not invent an assumption.
9. Tests: core data layer only, no E2E/UI; one happy path, rest on messy-data edge cases.

## Data decisions (change only with my approval; keep this table updated)

> Confirmed against sample data in Plan step 1 (2026-11-06). Sample counts in parentheses.

| Case | Decision |
| --- | --- |
| `is_test` | `true/1/yes/y/t` = test, `false/0/no/n/f/blank` = not test (case-insensitive). Anything else → flag, exclude from pipeline math. Test orders excluded by default; global toggle to include (67) |
| `status` refunded / cancelled | Counted in order volume and visible in order detail; excluded from stuck list and SLA/duration stats, even if they progressed (151 refunded / 33 cancelled with events) |
| `product = upload_only` | Counted in order volume; never enters the kit pipeline; not stuck. If it has events → flag `upload_only_has_events`, exclude those events from pipeline math (0) |
| Timestamp with no timezone | Parse as UTC; flag `naive_timestamp` (248 raw / 240 kept — 8 are duplicates/orphans, excluded before flagging) |
| Duplicate events | Key = (kit_id, event_type, **parsed UTC instant**); event_id ignored. Deduped, counted (343 exact + 126 same instant in different tz notation) |
| Same stage event repeated at different times | Use FIRST occurrence for stage timing; flag the repeat (0) |
| Events out of pipeline order (e.g. received before mailed) | Order by parsed instant. Keep event, flag kit; exclude the affected stage duration from stats (0) |
| Missing intermediate scan (e.g. no `sample_mailed` but `sample_received` exists) | Flag `missing_scan` once per missing step (counted per missing scan, not per event), on the first event after the gap; detail names the missing event type. A stage duration is measured only when both its start and end events exist; kit still advances (83 = 55 no mailed + 28 no delivered) |
| Event with order_id not in orders.csv | Excluded, counted (40) |
| Event whose order row is in orders.csv but was itself excluded (e.g. unknown product) | Excluded `order_excluded` (separate from orphan); example shows the order's exclusion reason (0) |
| Blank kit_id / blank order_id / unparseable timestamp / unknown event_type | Excluded, counted (0) |
| Date-only timestamp (`2026-05-01`, no time) | Unparseable → excluded `unparseable_timestamp` (0) |
| Ragged CSV row (too few / too many fields) | Kept; short rows get blank fields (then normal field checks apply), extras ignored; parse warning with row number shown in Data Quality (0) |
| Duplicate `order_id` in orders.csv | Keep first, exclude the rest `duplicate_order` (0) |
| Same kit_id on more than one order | Exclude events not matching the kit's first-seen order `kit_order_conflict`. First-seen = order on the kit's earliest event by parsed instant (ties: file order), so row order doesn't matter (0) |
| Blank `customer_id` | Keep order, flag `missing_customer_id` (0) |
| Blank `country` | Keep, no flag; displayed as "Unknown" (0) |
| Event timestamp after asOf or before order created_at | Flagged (0) |
| Stage that would start after asOf (e.g. order `created_at` after asOf) | Not started: stage excluded `starts_after_asof`, no days shown, not in "open now", never stuck; order keeps its `after_asof` flag (0) |
| Upload where no valid orders remain (header-only or all rows excluded) | Rejected with an error banner; previous dataset stays loaded (0) |
| `kit_replaced` | Closes the old kit (state: replaced, never stuck). Replacement kit = next kit_id on the same order whose first event is after the replaced event. Replacement kit's `kit_shipped` is measured from the `kit_replaced` time against the order→shipped target (205) |
| `kit_replaced` with no successor kit yet | Order state "awaiting replacement shipment", owner fulfillment; stuck if > order→shipped target since `kit_replaced` (4) |
| Later kit on an order with no `kit_replaced` link from the kit before it (none, or replaced before/after mismatch) | Keep both; newest kit is active; its ship stage measured from order `created_at`; flag first event of both kits `unlinked_kit` (0) |
| Events on a kit after its `kit_replaced` | Keep, flag `event_after_replaced`; kit stays closed (0) |
| QC result | Received → QC ends at the first `qc_passed` or `qc_failed`. QC passed → sequencing measured only from `qc_passed` |
| `qc_failed` with no replacement | Open; owner = support; stuck if no replacement within QC target window (0) |
| Paid kit order with no events | State "awaiting shipment"; stuck if > target for order→shipped (3) |
| Kit at `kit_delivered`, customer hasn't mailed | Counts as stuck after the delivered→mailed target, owner = customer; Stuck view has an owner filter (~278) |
| Volume / current stage / finished | Volume = orders. Current stage = stage of each order's active (latest) kit. Finished = orders whose final kit is `report_ready` |
| Refunded / cancelled orders in "where kits are now" | Not-finished ones get their own bucket "Refunded / cancelled" (284); ones that reached `report_ready` count as finished (75) |
| Data Quality view vs global filters | Dataset-level, not filtered (excluded rows may have no valid order); view shows a "not filtered" note |
| Order-level turnaround | order `created_at` → `report_ready` on the final kit |
| Median / p90 | Linear interpolation (numpy default) |
| Durations for kits still in a stage | Median/p90/% over use completed stage instances only; Durations view also shows "open now" and "open over target" counts per stage |
| Date filter | UTC calendar days on order `created_at` |
| Turnaround colors | green = within target; yellow = completed over target; red = open over target (stuck); always with a day count |
| Open stage on a refunded / cancelled order | Data layer keeps `open_over`/`open_ok`; UI renders it grey "closed (cancelled/refunded)", never red (124 cancelled never shipped) |

## Kit state & stuck definition

- Current stage = latest valid pipeline event on the kit.
- Terminal states: `report_ready` (complete), `kit_replaced` (closed).
- A kit is **stuck** when: order is paid, non-test, kit not terminal, and `asOf − time of last event` > target for the NEXT expected stage.
- Show `days in stage`, `days over target`, and `owner` from config:
  - awaiting shipment → fulfillment
  - shipped → delivered → carrier
  - delivered → sample mailed → customer
  - mailed → received → carrier
  - received → QC, QC passed → sequencing, sequencing → report → lab
  - qc_failed → support

## Hard rules — UI

- Every view respects the global filters: date range (on order `created_at`), product, country, include-test toggle. Filters live in URL query params.
- Every median / p90 shows its sample size `n`. Small n (< 5) is visually de-emphasized.
- Durations view: median, p90 and % over target per stage, split by product, with the target shown.
- Stuck view: sortable table, worst first, CSV export, row click → order detail.
- Order detail: a timeline across all kits on the order, with replacement chain visible and flagged events marked.
- Data Quality view: every exclusion/flag reason with counts and example rows.
- For UI work: Aim for a professional ops tool that offers easy to use dashboard. No marketing-page styling.

## Workflow

- Before coding a feature, state the plan in ≤ 5 bullets and wait if it touches data decisions.
- After every task, run `npm run typecheck && npm test`. Never say "done" while either fails.
- Small commits, conventional messages (`feat:`, `fix:`, `test:`, `chore:`), one logical change each.
- **When I correct you**, append an entry to `docs/AI_NOTES.md`: date/time, what you did, what was wrong, how it was caught. Keep it factual and terse. Do not soften it.
- **Never write or edit `README.md`.** I write it myself.
- Timebox awareness: if a task looks like > 15 minutes, say so and propose a smaller cut.
- Prefer working + tested over feature-complete. Do not gold-plate.

## Plan

1. Use rules.md to analyze requirements and data. Confirm the plan covers every requirement in challenge.html. Confirm or revise the Data decisions table.
2. Save the implementation plan in `docs/`.
3. scaffold basic structure of app.
4. data layer and tests. build one module at a time: parse, clean, state, metrics. Wait for review before moving on.
5. UI views: create each view and wait for manual QA check.
6. verify data using verify-metrics skill
7. Create a messy CSV and test if app works
8. leave 10 mins for me to manually write up README and deploy to netlify.
9. Polish UI if time left.
