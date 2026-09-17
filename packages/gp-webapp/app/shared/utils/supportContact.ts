// The support addresses the product shows a user. There are two, and which
// one depends on who works the queue, not on which file you are in.
//
// There used to be three, spread by which file you happened to be in: support@
// in the compliance modal and the re-election flow, campaignsuccess@ in the
// Pro upgrade and texting-compliance flows, and help@ in the voter-data and
// door-knocking error states. An audit of real Campaign Manager sessions found
// the assistant naming eight different contact routes across fifteen handoffs,
// and the product's own inconsistency was part of why. help@ is gone; the two
// below are deliberate. Import one rather than writing an address.
//
// The AI assistants read their own copy of this, in gp-api
// (src/chats/general/product-knowledge/productKnowledgePrompt.ts). It is not
// a cross-service contract, just a string both sides show, so it is duplicated
// rather than routed through @goodparty_org/contracts. Change both.

// General support: anything that is not Pro or texting compliance.
export const SUPPORT_EMAIL = 'support@goodparty.org'

// Pro upgrades and 10DLC texting compliance, which the campaign success team
// works directly. Keep these flows pointed here: a candidate mid-compliance
// needs the people who can look at their registration, not general triage.
export const PRO_COMPLIANCE_SUPPORT_EMAIL = 'campaignsuccess@goodparty.org'

// The public knowledge base, and where Get help goes when the support chat
// cannot be reached. It is a URL rather than an address on purpose: a browser
// always knows what to do with one. `mailto:` was tried first and is a dead
// click on any machine with no mail client registered — which is every
// environment where the chat is not loaded, and any ad-blocked session in
// production.
// The path matters: the bare host redirects to the marketing homepage, which
// is no help to someone already signed in and asking for it.
export const HELP_CENTER_URL = 'https://support.goodparty.org/knowledge-base'
