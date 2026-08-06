import { describe, expect, it } from 'vitest'
import { checkAmendmentFidelity } from './ordinanceFidelity.util'

describe('checkAmendmentFidelity', () => {
  it('passes when the redline strikes the real current-law text', () => {
    const baseline = 'Cameras are allowed in public places.'
    const draft = 'Cameras are {-allowed-}{+permitted+} in public places.'
    const result = checkAmendmentFidelity(draft, baseline)
    expect(result.ok).toBe(true)
    expect(result.reconstructed).toBe(result.baseline)
  })

  it('ignores whitespace and newline differences', () => {
    const baseline = 'Cameras are allowed.\n\n    Extra clause.'
    const draft = 'Cameras are allowed. Extra clause.'
    expect(checkAmendmentFidelity(draft, baseline).ok).toBe(true)
  })

  it('ignores curly quotes, dashes, and non-breaking spaces', () => {
    const baseline = 'The 30–day “retention” period applies.'
    const draft = 'The 30-day "retention" period applies.'
    expect(checkAmendmentFidelity(draft, baseline).ok).toBe(true)
  })

  it('flags a paraphrased deletion (struck text is not the real law)', () => {
    const baseline = 'for a given set of human-defined objectives'
    // The draft struck a reworded version of the definition, not the real text.
    const draft = 'for a given set of {-inputs-}{+parameters+}'
    const result = checkAmendmentFidelity(draft, baseline)
    expect(result.ok).toBe(false)
    // The drift is visible in the two normalized strings.
    expect(result.baseline).toContain('human-defined objectives')
    expect(result.reconstructed).toContain('inputs')
    expect(result.reconstructed).not.toContain('parameters')
  })

  it('flags an omitted section (silent repeal)', () => {
    const baseline = 'Sec 1. Cameras allowed. Sec 2. Signs required.'
    // The draft only reprints and edits Sec 1, dropping Sec 2 entirely.
    const draft = 'Sec 1. Cameras {-allowed-}{+permitted+}.'
    const result = checkAmendmentFidelity(draft, baseline)
    expect(result.ok).toBe(false)
    expect(result.baseline).toContain('Sec 2. Signs required.')
    expect(result.reconstructed).not.toContain('Sec 2')
  })

  it('flags invented "existing" text', () => {
    const baseline = 'Sec 1. Cameras allowed.'
    // (b) is shown as unchanged black-letter law but is not in the statute.
    const draft = 'Sec 1. Cameras allowed. (b) Audits are required annually.'
    const result = checkAmendmentFidelity(draft, baseline)
    expect(result.ok).toBe(false)
    expect(result.reconstructed).toContain('Audits are required annually')
    expect(result.baseline).not.toContain('Audits')
  })

  it('treats an empty baseline as nothing to check against, not a pass', () => {
    const draft = 'Sec 1. Some new content.'
    expect(checkAmendmentFidelity(draft, '').ok).toBe(false)
  })
})
