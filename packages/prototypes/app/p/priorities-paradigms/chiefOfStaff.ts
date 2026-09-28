// The real question a paradigm choice decides.
//
// Chief of Staff is not a tab you visit. It is a bar pinned to the bottom of
// every dashboard route (`FooterChatBar`, mounted by `DashboardLayout` unless a
// page passes `hideChatDock`), and tapping it opens a full conversation. So any
// priority surface with a composer of its own is putting a second text input
// and a second thread on a screen that already has one.
//
// Each shell below answers: how many composers are on screen, how many threads
// exist about this priority, does the bar know where you are, and what happens
// when you tap it.

export type Awareness =
  /** The bar has no idea you are mid-task. */
  | 'none'
  /** The bar reads the surface's shared state. */
  | 'reads'
  /** The bar and the surface are literally the same conversation. */
  | 'same'

export type BarRelation = {
  composers: number
  threads: number
  awareness: Awareness
  /** What happens when you tap the bar, on this shell. */
  onOpen: string
  verdict: string
  /** Only set where the two surfaces actively fight. */
  collision?: string
}

export const AWARENESS_LABEL: Record<Awareness, string> = {
  none: 'The bar does not know you are here',
  reads: 'The bar reads this surface',
  same: 'The bar is this conversation',
}

export const RELATIONS: Record<string, BarRelation> = {
  stepper: {
    composers: 2,
    threads: 2,
    awareness: 'none',
    onOpen:
      'A fresh Chief of Staff conversation opens over the flow. It does not know you were mid-step, so it greets you and asks what you need. The flow’s own composer is still down there underneath it.',
    collision:
      'The flow borrows the chief_of_staff scope, so its thread is listed in the bar’s own history popover, unlabelled, next to your real chats. Two inputs, two threads, one screen, same scope, neither aware of the other.',
    verdict:
      'This is what ships today if nothing changes. The flow page does not pass hideChatDock, so the bar is drawn straight over the flow’s pinned composer.',
  },
  dossier: {
    composers: 1,
    threads: 1,
    awareness: 'reads',
    onOpen:
      'The bar expands into the conversation you were already having. There is no second composer, because the dossier’s chat is the bar, opened tall.',
    verdict:
      'A surface stops needing a chat of its own the moment its state lives somewhere the bar can read. The case file is that somewhere, so one bar and one thread is enough.',
  },
  gates: {
    composers: 1,
    threads: 1,
    awareness: 'reads',
    onOpen:
      'The bar opens knowing which condition you are looking at, because the conditions are the shared state. Ask it anything and it answers against them, then points you back at the gate.',
    verdict:
      'Conditions are a small enough state that the bar is always useful without the feature owning a conversation. One bar, one thread, and the gates are just a view of it.',
  },
  'check-in': {
    composers: 1,
    threads: 1,
    awareness: 'same',
    onOpen:
      'Nothing new starts. The bar opens on the briefing that was already waiting for you, which is the same thing the check-in card shows.',
    verdict:
      'The most natural fit of the six. A check-in is a message from your chief of staff, so the bar is its home and Priorities becomes the list you skim on the way in.',
  },
  'next-action': {
    composers: 1,
    threads: 1,
    awareness: 'reads',
    onOpen:
      'The bar opens on the reasoning behind whichever action you were looking at. The list never had a composer, so there is nothing for the bar to collide with.',
    verdict:
      'The least ambiguous split of the six. The list is the glance, the bar is the conversation, and neither pretends to be the other.',
  },
  capability: {
    composers: 1,
    threads: 1,
    awareness: 'same',
    onOpen:
      'Nothing opens, because you are already inside it. This screen is the bar, expanded to full height.',
    verdict:
      'There is no relationship left to design, which is the argument for it. The bar is the product and Priorities is something it holds.',
  },
}
