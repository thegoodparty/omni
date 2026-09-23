import type { PrototypeMeta } from '@/shared/prototypeMeta'

const meta: Omit<PrototypeMeta, 'slug'> = {
  title: 'Analytics event explorer',
  description:
    'Search 592 analytics events, 19 business questions and 43 product areas to answer: do we have an event for that, and can I trust it?',
  author: 'tristan@goodparty.org',
  createdAt: '2026-09-22',
  status: 'draft',
}

export default meta
