import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { RedlineEditor } from './RedlineEditor'

describe('RedlineEditor', () => {
  it('renders deletions as <del> and insertions as <ins>', async () => {
    const { container, findByText } = render(
      <RedlineEditor value="Sec 1. {-old-}{+new+} text." editable={false} />,
    )
    // TipTap mounts on the client (immediatelyRender: false), so wait for it.
    await findByText('old')
    expect(container.querySelector('del')?.textContent).toBe('old')
    expect(container.querySelector('ins')?.textContent).toBe('new')
    expect(container.textContent).toContain('Sec 1.')
    expect(container.textContent).toContain('text.')
  })

  it('renders a plain (markup-free) body as plain text with no redline', async () => {
    const { container, findByText } = render(
      <RedlineEditor value="A plain new ordinance body." editable={false} />,
    )
    await findByText('A plain new ordinance body.')
    expect(container.querySelector('del')).toBeNull()
    expect(container.querySelector('ins')).toBeNull()
  })

  it('exposes ariaLabel as the accessible name of the editable region', async () => {
    const { findByRole } = render(
      <RedlineEditor value="Body." ariaLabel="Ordinance draft body" />,
    )
    await findByRole('textbox', { name: 'Ordinance draft body' })
  })

  it('marks the region aria-readonly when not editable (loop lock)', async () => {
    const { findByRole } = render(
      <RedlineEditor
        value="Body."
        editable={false}
        ariaLabel="Ordinance draft body"
      />,
    )
    const box = await findByRole('textbox', { name: 'Ordinance draft body' })
    expect(box).toHaveAttribute('aria-readonly', 'true')
    expect(box).toHaveAttribute('contenteditable', 'false')
  })
})
