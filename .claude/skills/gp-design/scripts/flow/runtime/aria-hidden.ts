// Stands in for aria-hidden, which a Radix modal uses to hide everything outside it
// from screen readers. In a frame that would hide the whole review page, and an open
// dialog drawn as one of Other states would hide it for good.
const keep = () => () => {}

export const hideOthers = keep
export const inertOthers = keep
export const suppressOthers = keep
export const supportsInert = () => false
