import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import DashboardError from './error'
import {
  GP_API_ACCESS_DENIED_DIGEST,
  GP_API_ACCESS_DENIED_MESSAGE,
} from '@/shared/util/actionFailure.util'

describe('DashboardError', () => {
  it('explains a gp-api 401/403 instead of crashing', () => {
    const error = Object.assign(new Error('redacted'), {
      digest: GP_API_ACCESS_DENIED_DIGEST,
    })

    render(
      <Theme>
        <DashboardError error={error} />
      </Theme>
    )

    expect(screen.getByText(GP_API_ACCESS_DENIED_MESSAGE)).toBeInTheDocument()
  })

  it('passes any other error up to the global error page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = Object.assign(new Error('boom'), { digest: '123' })

    expect(() => render(<DashboardError error={error} />)).toThrow('boom')
  })
})
