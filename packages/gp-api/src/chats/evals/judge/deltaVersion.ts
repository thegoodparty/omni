export class UnpinnableSqlError extends Error {}

// A Delta version is a whole number. Checked because the version is spliced
// into SQL that has already cleared the agent-facing validator, whose
// aggregate-only, allowlisted-column guarantees are the whole reason the
// constituent tool is safe — anything else here would be SQL nobody
// validated.
export const assertDeltaVersion = (version: string): void => {
  if (!/^\d+$/.test(version)) {
    throw new UnpinnableSqlError(
      `"${version}" is not a Delta table version; only a whole number can ` +
        'be spliced into an already-validated query',
    )
  }
}
