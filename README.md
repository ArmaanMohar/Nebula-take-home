# Kit Lifecycle Dashboard

URL: https://nebula-take-home-olive.vercel.app/

## Approach

- Focus on creating a working MVP
- Tests focus on data logic, no UI or end to end tests
- QA with messy CSV files

## Data decisions

- "Now" = date data had latest timestamp which is Oct 20 otherwise everything would appear as late
- Orders:
  - Test: hidden
  - Refunded and Cancelled: count toward volume but left out of stuck and duration stats.
  - Upload only: count toward volume but never enter kit pipeline
- Replacements: new kit is linked to old one when it is the next kit on the same order and its first event comes after the old kit's replaced date. Replaced kit is closed and new kit's timer begins.
- Stats: I used median and p90 instead of average because a few lost kits would skew the avg far away from what a kit typically experiences.
- Date-only timestamps: rejected from analysis since we need time of day to properly determine if the order of events is correct.
- Duplicates / out-of-order / unknown order IDs: never silently dropped, they are flagged or excluded with a reason.
  - Duplicates match on kit, event type, and timestamp
  - Out of order: kept and flagged. Stage they affect are left out of the stats.
  - Unknown Order ID: events for orders not in orders.csv are excluded from stats
- Repeated events: I only counted the first event so the stage's timer begins on the first occurence instead of a repeated event.
- Every excluded row is shown in the Data Quality view.

## Assumptions

- orders.csv product must be one of the products in the spec; anything else excludes the order since the product is unknown.
- Timestamp that only has day without time is not assumed to be midnight.

## What I'd do next

- Add category of waiting on customer so kits sitting at delivered past 45 days do not bury the kits the team can actually fix.
- Charts: fix small categories getting lost next to big ones.
- Layout: less text, clearer flow of UX.
- Persistence: database to store csv.
- Engineering: proper time lib for parsing, branches + PRs
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
- CSV data does not merge, it replaces the old files if valid.
