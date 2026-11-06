# Kit Lifecycle Dashboard

URL:

## Approach

- Focus on creating a working MVP
- Tests focus on data logic, no UI or end to end tests
- QA with messy CSV files

## Data decisions

- "Now" = date data was created which is Oct 20 otherwise everything would appear as late
- Date-only timestamps: rejected from analysis since we need time of day to properly determine if the order of events is correct.
- Duplicates / out-of-order / unknown order IDs:
  - Duplicates match on kit, event type, and timestamp
  - Out of order: kept and flagged. Stage they affect are left out of the stats.
  - Unknown Order ID: events for orders not in orders.csv are excluded from stats
- Every excluded row is shown in the Data Quality view.

## Assumptions

- orders.csv product must be one of the products in the spec; anything else excludes the order since the product is unknown.
- Timestamp that only has day without time is not assumed to be midnight.

## What I'd do next

- Charts: fix small categories getting lost next to big ones.
- Layout: less text, clearer flow of UX.
- Persistence: database to store csv.
- Engineering: proper time lib, branches + PRs
- track trends over time so we know if turnaround times are getting better or worse.
- Breakdown time by country and carrier to pinpoint where delays come from.
- Automated alerts when certain stages are hit
- Better Instructions:
  - The upload button only says "select both files", it should tell you what files it needs.
  - Clicking on a row in stuck kits opens order detail which is not obvious.

## How I used AI

- analyze csv data, plan data decisions, plan code implementation. Run Agent using messy data to validate website functions without crashing.

## Known limitations

- The Stuck view's owner and stage filters aren't kept in the URL, unlike the global filters.
- There is no dark mode and no responsive design for mobile or tablets.
- JS bundle optimization.
