# Subscriptions

The local demo models separate agency and factory payers. Worker-count tiers are stored as workspace configuration instead of being used for feature gating. Agency demo workers remain on the legacy flow when the agency has no subscription record; once a test plan is configured, new billable workers must fit its limit, and deactivating that plan blocks further additions. Factory-owned workers require an active test entitlement from the start, while agency workers remain outside the factory worker limit.

The test subscription changes local business permissions and never charges money. No payment provider, billing account, or external billing service is connected.

## Subscription invoice delivery for hosted agencies

The agency's **Subscription invoice email** is already persisted per organization as
`timeax_core.agency_contact_settings.contact_email` (the existing agency profile API
returns it as `contactEmail`). Keep it separate from the signed-in actor's address.
Saving it does not send mail, change billing identity, or enable payments.

Before enabling checkout, show this address for confirmation and require a valid
recipient; do not silently fall back to the sign-in address. Resolve the address on
the server for the agency that owns the order and snapshot the confirmed recipient
with the order. Existing saved addresses should also be confirmed at checkout.

Send the invoice only after the payment is confirmed and the official invoice has
been issued by the configured invoicing system. Queue delivery once per issued
invoice using its stable identifier, and retry failures without creating another
invoice or sending duplicates. Retries must use the same recorded recipient.
Never email a checkout receipt or a local test PDF as an official invoice.
Commercial payment and invoice dispatch remain disabled until an issuer and a
payment confirmation flow are configured and verified.
