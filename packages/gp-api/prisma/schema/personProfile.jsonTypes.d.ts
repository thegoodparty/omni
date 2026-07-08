declare global {
  export namespace PrismaJson {
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
