# AI Notes

Running log of AI mistakes corrected by the developer.

## 2026-11-06 11:09 — blank customer_id treated as harmless

- **What I did:** In `clean.ts`, orders with a blank `customer_id` were kept silently: no flag, no exclusion. In my summary I lumped it together with blank `country` as an open "judgment call".
- **What was wrong:** `customer_id` is the only link between an order and a person. Without it ops can't tell whose kit it is, so it has to be visible as a data-quality issue. Treating it like an optional field such as country was wrong. Rule 2 says suspicious rows must be flagged, and I didn't flag these.
- **How it was caught:** The developer reviewed the clean step summary and said customer_id must be flagged. Fixed in `aef8f22`: added the `missing_customer_id` flag (order kept), a fixture test and a decisions-table row.

## 2026-11-06 11:37 — wrong expected value in a QA checklist

- **What I did:** After adding the current-stage chart, I told the developer to expect the Delivered bar (677) to be "much longer than the others" on the sample.
- **What was wrong:** Report ready (`complete`) is the longest bar at 2,517. My own earlier sanity run printed `complete:2517`. I wrote the expectation from memory and didn't check it against that output.
- **How it was caught:** The developer did manual QA on the sample data and reported the actual bar lengths.

## 2026-11-06 11:54 — faded/grey small-sample styling left unexplained

- **What I did:** In the Durations chart I faded bars with n < 5, and in the Durations table and the turnaround tile I greyed those values. The only explanation was a terse caption ("Faded bars: fewer than 5 samples") away from the chart, and no reason was given.
- **What was wrong:** I assumed the user would already know what the fade means and why it matters. An ops user seeing faded bars needs the meaning and the consequence (too few kits for a reliable median) next to the visual. Visual encodings must be explained where they appear.
- **How it was caught:** The developer asked why the bars were faded during QA of the median chart. Fixed by adding a "Faded = …" key in the chart legend, a reason in the tooltip and table hover, a "why" footnote for grey table values, and a note on the greyed turnaround tile.

## 2026-11-06 12:12 — wrong file named in empty-file upload error (self-caught)

- **What I did:** In `src/lib/dataset.ts`, `explainUnknown` guesses which file an unrecognized upload was meant to be by picking the kind with the fewest missing columns.
- **What was wrong:** For a 0-byte file every column is missing, so it always picks "events" (6 required columns vs 7). An empty `orders.csv` is reported as "The events file is empty or has no header row." That message is misleading.
- **How it was caught:** My own messy-CSV upload test (step 7, `test-data/zero-bytes`), not by the developer. Not yet fixed.

## 2026-11-06 12:12 — negative stage duration for an order created after asOf (self-caught)

- **What I did:** In `src/lib/kits.ts`, `openInstance` computes an open stage's days as `asOf − start` with no guard. I applied the "after asOf → flag" decision as a flag only.
- **What was wrong:** An order created after the data date gets an open Order → Shipped stage of −214.5 d, labelled "open, within target" and counted in Durations "Open now". I didn't think through what the flag means for stage timing.
- **How it was caught:** My own messy-CSV upload test (step 7, order `m20` in `test-data/messy`), not by the developer. Not yet fixed.
