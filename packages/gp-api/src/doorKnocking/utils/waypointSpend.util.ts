import { Prisma } from '../../generated/prisma'

// The Geoapify spend ledger. This used to be half of a per-organization
// budget: 500 stops a day, enforced per org, with an admin override to raise
// a single one. That limit is gone — the only per-account ceiling now is five
// lists a day (campaignQuota.util.ts) — and what survives is the recording.
//
// Recording survives because it is the durable record of what door knocking
// costs, and the total is now the only thing anyone bounds: the daily credit
// pool is shared across every organization, so the bill scales with how many
// hold the feature and nothing in the code caps it. What the alerts watch is
// the `DoorKnockingSpend` log line rather than these rows — Loki is where the
// tiers in deploy/components/alerting/geoapify-budget-alerts.ts can sum a
// rolling window cheaply. This table is the version that outlives log
// retention, and the one the per-org SQL in docs/door-knocking.md
// § Spend visibility is run against when a tier fires and somebody has to
// find which organization caused it.
//
// So no code reads it today, and that is the intended state rather than dead
// weight: a ledger whose only reader is an incident is still the thing that
// answers the incident. Prune it and the answer is gone with it.
//
// Written the moment the vendor returns. `client` must be the plain Prisma
// client, NOT the create transaction's `tx` — committing independently of
// that transaction is the entire point, since a spend recorded inside it is a
// spend the ledger forgets the moment it rolls back, and the money left
// regardless.
//
// A slug and not the organization: this appends to the ledger and has no
// business reading what the org is entitled to.
//
// Callers own the failure: the vendor has already been paid by the time this
// runs, so a write failure here must be logged rather than allowed to turn
// billed work into a failed create.
export const recordWaypointSpend = async (
  client: Prisma.TransactionClient,
  spend: {
    organizationSlug: string
    doorKnockingTurfId: number
    waypoints: number
    credits: number
  },
): Promise<void> => {
  await client.doorKnockingRoutePlannerSpend.create({ data: spend })
}
