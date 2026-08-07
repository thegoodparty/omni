import { type ReactNode } from 'react'

// Section eyebrow — mirrors the styleguide ContentCard's built-in eyebrow exactly:
// `text-primary text-xs font-bold uppercase` (ContentCard defaults `eyebrowEmphasis`
// to true → `text-primary`). This is the ONE place the DS uppercases, so standalone
// section labels match it 1:1 rather than inventing a treatment. See NEW_COMPONENTS.md.
export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="text-primary text-xs font-bold uppercase">{children}</p>
)
