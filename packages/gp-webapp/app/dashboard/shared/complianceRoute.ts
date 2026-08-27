// Where "start verification" goes, by TCR compliance status. Plain module
// (no 'use client') so server components can import the paths too; the
// ComplianceModal and both outreach startVerification callers share it so the
// route decision can't drift between surfaces.

export const SUBMIT_PIN_PATH =
  '/dashboard/profile/texting-compliance/submit-pin'

// An already-Pro candidate routed into the pre-payment wizard dead-ends on its
// SUCCESS surface (ENG-10441) — the standalone election-filing form is the
// correct verification entry for them.
export const ELECTION_FILING_PATH =
  '/dashboard/profile/texting-compliance/election-filing'

// `submitted` means the registration reached the carriers and a PIN may be
// waiting; everything else (no record, pending, rejected, error, approved
// spine with unverified CV) starts or restarts at the filing form.
export const getComplianceRoute = (
  status: string | null | undefined,
): string => (status === 'submitted' ? SUBMIT_PIN_PATH : ELECTION_FILING_PATH)
