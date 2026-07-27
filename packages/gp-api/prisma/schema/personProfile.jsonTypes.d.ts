declare global {
  export namespace PrismaJson {
    // Accomplishment cards on the public profile render a CONSTANT "RESOLVED"
    // tag (a fixed UI label on the accomplishments section), so there is
    // deliberately no per-accomplishment `status` field here. Progress state
    // that varies per item lives on PersonProfileIssue.status (the priorities
    // section) instead. If a future design needs per-accomplishment status,
    // add an optional `status` here rather than a new column.
    export type PersonProfileAccomplishments =
      | {
          title: string
          description?: string | null
          date?: string | null
        }[]
      | null

    // Recent Experience rows (§4). Seeded from the election-api spine
    // (Candidacy/OfficeHolder) and then owner-editable — `source` records
    // whether a row originated from BallotReady or was added/edited in-product
    // so the UI can label auto-populated vs. user-authored rows.
    export type PersonProfileRecentExperience =
      | {
          title: string
          organization?: string | null
          term?: string | null
          source?: 'ballotready' | 'user' | null
        }[]
      | null
  }
}

export {}
