import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { Button } from '@styleguide'
import { render } from 'helpers/test-utils/render'
import { CompactCardLink, CompactCardStatic } from './cardShell'

const TITLE = 'Residents across the district'
const SUBTITLE = 'Text 10,000 of 53,779: 5,000 now, 5,000 two weeks later'

describe('CompactCardStatic', () => {
  it('stacks the button under the text on a narrow card and wraps the text', () => {
    render(
      <CompactCardStatic
        title={TITLE}
        subtitle={SUBTITLE}
        action={<Button size="small">Start the text</Button>}
      />,
    )

    const layout = screen.getByTestId('compact-card-static-layout')
    expect(layout).toHaveClass('flex-col', '@sm:flex-row')
    expect(layout.parentElement).toHaveClass('@container')
    expect(screen.getByText(TITLE)).not.toHaveClass('truncate')
    expect(screen.getByText(SUBTITLE)).not.toHaveClass('truncate')
  })
})

describe('CompactCardLink', () => {
  it('wraps the text rather than truncating it', () => {
    render(<CompactCardLink title={TITLE} subtitle={SUBTITLE} href="/x" />)

    expect(screen.getByText(TITLE)).not.toHaveClass('truncate')
    expect(screen.getByText(SUBTITLE)).not.toHaveClass('truncate')
  })
})
