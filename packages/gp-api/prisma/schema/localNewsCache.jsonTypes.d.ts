export {}

declare global {
  export namespace PrismaJson {
    export type LocalMediaOutlet = {
      name: string
      type: 'TV' | 'print' | 'radio'
      description: string
      email?: string | null
      phone?: string | null
      address?: string | null
    }
  }
}
