# Implementation Plan — Kit Lifecycle Dashboard

The spec is the Data decisions table and the stuck definition in `CLAUDE.md`. This doc covers *how* to build it.

## Time budget (2h total)

| Step | Budget |
|---|---|
| 1–2 Analysis + plan | done |
| 3 Scaffold (Vite/React/TS/Tailwind/Vitest, folders, sample CSVs) | 10 min |
| 4 Data layer + tests (parse → clean → kits → metrics) | 40 min |
| 5 Views (Overview, Durations, Stuck, OrderDetail, DataQuality) | 40 min |
| 6–7 verify-metrics + messy CSV run | 10 min |
| 8 README + Netlify (you) | 10 min |
| 9 Polish | leftover |

Cut order if behind: the DataQuality example rows, then the Durations chart (keep the table), then the Overview chart (keep the tiles).

## Data flow

```
File/fetch text ──parse.ts──▶ RawRow[] + ParseError[]
               ──clean.ts──▶ { orders, events, report: DataQualityReport, asOf }
               ──kits.ts───▶ OrderModel[] (kits, chain, state, stage times)    ← computed once per dataset
filters ──metrics.ts(models, filters, asOf)──▶ overview / durations / stuck / orderDetail
```

The pipeline is built once per upload and memoized in `state/dataset`. Filters only re-run the cheap `metrics` selectors.

## `src/lib/config.ts`

- `EVENT_TYPES` and `PRODUCTS` (`wgs_30x`, `wgs_100x`, `upload_only`); `KIT_PRODUCTS` excludes upload_only. Also `STATUSES` and `SOURCES`.
- `EVENT_RANK`: pipeline position, used for out-of-order checks (`qc_passed` and `qc_failed` share a rank).
- `STAGES`: the only source of targets and owners.

| id | start | end | targetDays | owner (while waiting) |
|---|---|---|---|---|
| `ship` | order created_at, or `kit_replaced` on the predecessor | kit_shipped | 3 | fulfillment |
| `deliver` | kit_shipped | kit_delivered | 7 | carrier |
| `mail` | kit_delivered | sample_mailed | 45 | customer |
| `receive` | sample_mailed | sample_received | 14 | carrier |
| `qc` | sample_received | qc_passed \| qc_failed | 7 | lab |
| `sequence` | qc_passed | sequencing_complete | 28 | lab |
| `report` | sequencing_complete | report_ready | 5 | lab |
| `replace` | qc_failed | next kit's kit_shipped / kit_replaced | 7 (= qc target) | support |

- `NEXT_STAGE_AFTER[event]` maps the latest event to the stage being waited on, which gives the target and owner for stuck.
- `MS_PER_DAY`, `SMALL_N = 5`, `EXAMPLES_PER_REASON = 5`, and `REQUIRED_COLUMNS` per file.

## `types.ts`

- `Order { orderId, createdAt: number /*UTC ms*/, customerId, product, country, status, isTest, raw }`
- `KitEvent { eventId, orderId, kitId, type, at: number, source, raw, flags: FlagReason[] }`
- `Kit { kitId, orderId, events, firstAt: Partial<Record<EventType, number>>, startAt, state, replaces?, replacedBy?, flags }`
- `OrderModel { order, kits /*chain order*/, activeKit?, state, lastEventAt?, stages: StageInstance[] }`
- `StageInstance { stageId, kitId, start?, end?, days?, status: 'done_ok' | 'done_over' | 'open_ok' | 'open_over' | 'excluded' }`. This one value drives both the green/yellow/red colors and the stuck list.
- `ExclusionReason` (enum): `missing_required_field`, `unparseable_timestamp`, `unknown_event_type`, `unknown_product`, `unknown_status`, `unknown_is_test`, `orphan_order_id`, `duplicate_event`, `duplicate_order`, `kit_order_conflict`, `upload_only_event`
- `FlagReason` (enum): `naive_timestamp`, `repeated_stage`, `out_of_order`, `missing_scan`, `after_asof`, `before_order_created`, `event_after_replaced`, `unknown_source`, `unknown_country_format`
- `DataQualityReport { inputRows: {orders, events}, excluded: Record<ExclusionReason, {count, examples}>, flagged: Record<FlagReason, …> }`

## Modules

**parse.ts**: `parseCsv(text, kind) → { rows, missingColumns, errors }`
- Papaparse with `header: true`, `skipEmptyLines: 'greedy'`, and `transformHeader` that trims, lowercases and strips the BOM. Papaparse handles CRLF and quoted fields; extra columns are ignored.
- Values are trimmed, and categoricals are lowercased (country is uppercased) in `clean`, not here. Raw strings are kept for examples (rule: don't alter data on import).
- `parseTimestamp(s) → { ms, naive } | null`: accepts ISO with Z or an offset, plus `YYYY-MM-DD[ T]HH:MM[:SS]` with no tz (parsed as UTC, `naive = true`). It never uses `new Date(string)` on ambiguous input.

**clean.ts**: `clean(rawOrders, rawEvents) → { orders, events, report, asOf }`
- `exclude(row, reason)` and `flag(row, reason)` are the only paths that remove or annotate rows.
- Orders are checked in this order: required fields → timestamp → product/status/is_test → duplicate order_id.
- Events are checked in this order: required fields → timestamp → event_type → orphan → kit/order conflict → upload_only event → dedupe on (kit, type, ms).
- `asOf` = max `at` over the remaining events, falling back to max `createdAt`. The `after_asof` and `before_order_created` flags are applied after that.

**kits.ts**: `buildModels(orders, events, asOf) → OrderModel[]`
- Group events by kit and sort by `at`. `firstAt` uses the first occurrence of each type; any repeat gets `repeated_stage`. Events out of rank order get `out_of_order`, and the stage they affect is marked `excluded`.
- Chain kits per order by first event time. A kit after a `kit_replaced` gets `replaces`, and its `ship` stage starts at the `kit_replaced` time.
- Stage instances follow the STAGES table. If the start or end event is missing while a later stage exists, the instance is `excluded` and the kit is flagged `missing_scan`.
- Order state = the active (last) kit's state: `awaiting_shipment` (no kits), `awaiting_replacement` (last kit replaced), `in_<stage>`, or `complete`.

**metrics.ts** (pure; every function takes `(models, filters, asOf)`)
- `applyFilters`: date range on UTC `createdAt`, product, country, `includeTest`.
- `overview`: order counts by product/status, current-state counts (active kit per order), finished, stuck count, and order turnaround median/p90/n.
- `stageDurations`: per stage × product → `{ n, median, p90, pctOver, target, openNow, openOver }`. Paid orders only. Percentiles use linear interpolation.
- `stuckList`: paid, non-test, kit products, with open stages where `asOf − start > target`. Each row has `{ orderId, kitId, product, country, stage, owner, daysInStage, daysOver, lastEventAt }`, sorted by `daysOver` descending.
- `orderDetail(orderId)`: the model plus flags, for the timeline.
- `toCsv(rows)` for the stuck export. All values are escaped.

## State & UI

- `state/filters.ts`: the `useFilters()` hook reads and writes `URLSearchParams` (`from`, `to`, `product`, `country`, `test`). Plain `history.replaceState`, no router dependency. The view is selected with the `view=` param.
- `state/dataset.ts`: loads `/sample/*.csv` on start. Upload accepts two files (matched by header, not filename). On a parse error it shows a banner listing the missing columns and keeps the previous dataset.
- Shell: header with "Data as of …", the upload control and the filter bar, plus a tab nav. Wrapped in an error boundary.
- **Overview**: KPI tiles (orders, kit orders, in progress, finished, stuck) and a current-stage bar chart.
- **Durations**: a table with stage rows and per-product columns showing median / p90 / % over / n, with the target column shown. Cells with n < 5 are muted. Plus a grouped bar chart of medians.
- **Stuck**: a sortable table, owner and stage filters, CSV export, and row click → `view=order&id=`.
- **OrderDetail**: an order_id search box. A timeline per kit in chain order with the replacement arrow, stage chips colored green/yellow/red with day counts, and flag badges.
- **DataQuality**: one row per reason with count, description and expandable example rows rendered as text.
- All CSV content is rendered as React text nodes only. No `dangerouslySetInnerHTML`.

## Tests (`src/lib/__tests__`, one fixture per rule)

1. Happy path: one order through all 7 stages gives the expected stage days and a complete state.
2. parse: BOM + CRLF + blank lines + quoted field + reordered or extra columns + header case and whitespace.
3. parse: a missing required column returns `missingColumns` and doesn't throw.
4. timestamps: Z, offset and naive all resolve to the same instant; garbage becomes `unparseable_timestamp`.
5. dedupe: the same instant written in two tz notations is deduped once.
6. orphan, blank kit_id, unknown event_type and duplicate order are each excluded and counted.
7. Replacement chain: the replaced kit is never stuck, and the successor's ship stage is measured from `kit_replaced`. Replaced with no successor → `awaiting_replacement`.
8. missing_scan: that stage is excluded and later stages are still measured.
9. Out-of-order and repeated stage: flagged, first occurrence used.
10. Stuck: paid no-event order > 3d is stuck; refunded, cancelled, test and upload_only orders never are; an open kit within target isn't.
11. asOf comes from the data (fake system time is set to 2030 and the result must not change).
12. Percentiles: median and p90 linear interpolation on known arrays.

## Resolved

- Open stage instances: completed-only stats + "open now / open over target" columns (decision table, 2026-11-06).

## Backlog (deferred, in priority order)

- Durations view: grouped bar chart of medians per stage × product (table ships first; chart was first on the cut list).
