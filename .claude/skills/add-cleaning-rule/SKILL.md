---
name: add-cleaning-rule
description: Add or change a data cleaning/exclusion/flag rule end to end — config, implementation, fixture test, and the decisions table. Use whenever data handling logic changes.
---

# Add Cleaning Rule

## Steps

1. **Confirm the rule with me** in one sentence: what case, what action (exclude / flag / normalize), and why. Wait for approval unless I already stated it.
2. **Types:** add a new value to the `ExclusionReason` or `FlagReason` enum in `src/lib/types.ts`, with a short human-readable label used by the Data Quality view.
3. **Implement** in `src/lib/clean.ts` (or `kits.ts` if it's about kit state). Use `exclude(row, reason)` / `flag(row, reason)` only — no ad hoc filtering.
4. **Fixture:** create `src/lib/__tests__/fixtures/<rule-name>/orders.csv` + `kit_events.csv` with the minimum rows needed: one row that triggers the rule and one control row that doesn't.
5. **Test** in `src/lib/__tests__/clean.test.ts` (or `kits.test.ts`). Assert:
   - the triggering row is excluded/flagged/normalized as intended
   - the control row is untouched
   - `DataQualityReport` counts for this reason are exact
   - downstream effect if relevant (e.g. stage duration not included, kit not stuck)
6. **Update the Data decisions table** in `CLAUDE.md` with the new row.
7. Run `npm run typecheck && npm test`. Fix until green.
8. Commit: `feat(data): <rule>` with the test in the same commit.

## Don'ts

- Don't change an existing decision without telling me which row of the table changes.
- Don't widen a rule beyond the case described ("while I'm here…").
