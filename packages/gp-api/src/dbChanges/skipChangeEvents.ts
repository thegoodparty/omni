import { Prisma } from '@/generated/prisma'

// Turns capture off for the rest of a transaction: the next statement that
// needs to write rows without handlers (a backfill, a repair, a test's
// fixtures) wraps them in this. Local to the transaction, so it ends with it.
//
// The flag is the transaction's own id, not 'on', and the capture trigger skips
// only when current_setting matches txid_current()::text. A GUC cannot say
// whether it was set with SET LOCAL or plain SET, so 'on' would also honour a
// SET that leaked onto a pooled connection, and every write that connection
// served afterwards would go uncaptured with nothing to show for it. The id
// only matches inside the transaction that set it.
//
// The gap row is the other half: a skipped write never reaches a handler, so
// the reason it did not has to be findable afterwards. It commits or rolls back
// with the writes it explains.
//
// set_config, not SET LOCAL: SET takes a literal and txid_current() has to be
// evaluated. Its third argument is what makes the setting transaction-local.
export const skipChangeEvents = async (
  tx: Prisma.TransactionClient,
  reason: string,
): Promise<void> => {
  await tx.$executeRaw`
    SELECT set_config('app.skip_change_events', txid_current()::text, true)
  `
  await tx.$executeRaw`
    INSERT INTO db_change_gap (kind, detail)
    VALUES ('skip', jsonb_build_object('reason', ${reason}::text))
  `
}
