# Subscriptions

The local demo models separate agency and factory payers. Worker-count tiers are stored as workspace configuration instead of being used for feature gating. Agency demo workers remain on the legacy flow when the agency has no subscription record; once a test plan is configured, new billable workers must fit its limit, and deactivating that plan blocks further additions. Factory-owned workers require an active test entitlement from the start, while agency workers remain outside the factory worker limit.

The test subscription changes local business permissions and never charges money. No payment provider, billing account, or external billing service is connected.
