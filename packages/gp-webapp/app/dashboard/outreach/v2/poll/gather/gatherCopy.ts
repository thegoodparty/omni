// Serve copy for Gather more feedback. SERVE_* so the vocabulary check reads
// it as a Serve region (docs/product-vocabulary.md).

export const SERVE_GATHER_COPY = {
  headerLabel: 'Gather more feedback',
  steps: {
    size: 'How many more messages would you like to send?',
    when: 'When should we send them?',
    review: 'Review & pay',
  },
  size: {
    caption:
      "We won't send text messages to constituents you've already messaged.",
    loading: 'Loading your options',
    min: {
      title: (count: string) => `${count} constituents`,
      body: 'The minimum for a reliable sample',
    },
    all: {
      title: (count: string) => `${count} constituents`,
      body: "Everyone you haven't messaged yet",
    },
    budget: {
      title: 'Set a budget',
      body: "Pick a dollar amount and we'll work out how many constituents it reaches.",
      label: 'Budget in dollars',
      reach: (count: string) => `${count} constituents`,
    },
    price: (dollars: string) => `$${dollars}`,
    perText: (price: string) => `Each message costs $${price}.`,
    exhausted: "You've already messaged everyone we can reach.",
  },
  when: {
    caption: "We'll send them once we've reviewed your request.",
    alertTitle: 'We review it first',
    alertBody:
      'This takes up to 2 business days. We send it as soon as it is approved.',
  },
  review: {
    caption: 'Review your request and complete your payment.',
    cardTitle: 'More feedback',
    recipients: 'Additional recipients',
    price: 'Price per message',
    total: 'Total',
    paymentTitle: 'Payment details',
    dueToday: (total: string) => `$${total} due today`,
    dueTodayBody: 'One-time charge for these messages.',
    cardFailed: "Your payment didn't go through",
    prepareFailed:
      "We couldn't set up your purchase. Go back a step and try again.",
  },
  success: {
    title: 'Your request is in review',
    body: "We'll review it within 2 business days.",
    reach: (count: string) =>
      `Once it's approved, it goes to ${count} more constituents.`,
    action: 'Back to results',
  },
  createFailed: "We couldn't set this up. Try again.",
}
