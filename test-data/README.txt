Hand-made CSV pairs for manually testing the Upload button. Not deployed.

small/   12 orders, 36 events. Expected (default filters, test orders hidden):
  - Data as of 2026-03-01 00:00 UTC
  - Orders 10 (12 rows; s11 excluded: unknown product; s08 is a test order, hidden)
  - In progress 6
  - Finished 2 (s01; s02 via replacement kit)
  - Stuck 3, worst first by days over target:
      s10 carrier     (shipped 2026-02-10, 18.4 d vs 7)
      s03 fulfillment (no events, created 2026-02-20, 8.5 d vs 3)
      s04 customer    (delivered 2026-01-12, 47.3 d vs 45)
  - Data quality: 1 unknown_product, 1 orphan event (ord_ghost), 1 duplicate (e015 = e014 in -05:00),
                  1 missing_scan (s06 no kit_delivered), 2 naive timestamps (s04 order + e023), 1 missing_customer_id (s12)

broken/  same orders; kit_events is missing the kit_id column → upload must show an error
         banner and keep the previous data.

messy/      BOM + CRLF, renamed/reordered/extra columns, quoted commas and newlines, blank and
            whitespace-only lines, ragged rows, every bad-timestamp form (date-only, garbage, hour 25,
            naive, lowercase t/z, offsets, fractional seconds), unknown product/status/is_test/event/source,
            duplicate order, duplicate events (exact + other tz), kit on two orders, orphan, upload_only
            with events, out-of-order / repeated / missing scans, event after kit_replaced, unlinked kits,
            event before order created, order created after asOf, formula + <script> injection, unicode.
            Expected: loads; 23 order rows → 15 kept, 44 event rows → 31 kept; 8 stuck; 3 parse warnings.
no-events/  3 orders, header-only events. asOf falls back to max created_at (2026-03-21); all durations "–".
empty/      header-only files → error banner "No valid orders found…", previous data kept.
zero-bytes/ 0-byte files → error banner, previous data kept.
