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
  }
}

export {}
