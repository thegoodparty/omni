import type { PrototypeMeta } from '@/shared/prototypeMeta'

const meta: Omit<PrototypeMeta, 'slug'> = {
  title: 'Example Prototype',
  description: 'A starter shell showing the sidebar + two screens.',
  author: 'GoodParty Design',
  createdAt: '2026-06-23',
  status: 'draft',
}

export default meta
