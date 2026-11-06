# Decisions

- focus on a working MVP. A polished UI and tests come after. Priority is a working dashboard.
- persistence so reload does not wipe state: on frontend: store in location storage if data isn't sensitive, redux. proper database
- iso timestamp vs country code: timezone differences?
- Date only timestamp: rejected from analysis since we need time of day to proper determine if order of events is correct.

## Assumptions

- orders.csv -> product field has a list of approved products as defined in the spec and anything outside the specified products will exclude the order since product is unknown
