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
})
