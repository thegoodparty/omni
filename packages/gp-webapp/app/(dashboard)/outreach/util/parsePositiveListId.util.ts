// ENG-10762: shared by the server page (searchParams) and the client compose
// deep link (also searchParams, on the combined ?compose=&listId= path) so
// the "ignore anything that isn't a positive integer" rule can't drift
// between the two call sites.
export const parsePositiveListId = (
  raw: string | null | undefined,
): number | undefined => {
  const parsed = raw !== null && raw !== undefined ? Number(raw) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
