# AI Notes

Running log of AI mistakes corrected by the developer.

## 2026-11-06 11:09 — blank customer_id treated as harmless

- **What I did:** In `clean.ts`, orders with a blank `customer_id` were kept silently: no flag, no exclusion. In my summary I lumped it together with blank `country` as an open "judgment call".
- **What was wrong:** `customer_id` is the only link between an order and a person. Without it ops can't tell whose kit it is, so it has to be visible as a data-quality issue. Treating it like an optional field such as country was wrong. Rule 2 says suspicious rows must be flagged, and I didn't flag these.
- **How it was caught:** The developer reviewed the clean step summary and said customer_id must be flagged. Fixed in `aef8f22`: added the `missing_customer_id` flag (order kept), a fixture test and a decisions-table row.
