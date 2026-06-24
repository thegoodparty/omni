export type PrototypeStatus = 'draft' | 'handoff-ready' | 'shipped'

export type PrototypeMeta = {
  slug: string
  title: string
  description: string
  author: string
  createdAt: string
  status: PrototypeStatus
}

export const sortPrototypes = (metas: PrototypeMeta[]): PrototypeMeta[] =>
  [...metas].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
