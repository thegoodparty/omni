import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import AddScriptStep from './AddScriptStep'
import type { Campaign } from 'helpers/types'

vi.mock(
  'app/dashboard/components/tasks/flows/AddScriptStep/SelectAiTemplateScreen',
  () => ({
    fetchAiContentCategories: vi.fn().mockResolvedValue([]),
    SelectAiTemplateScreen: () => null,
  }),
)

const campaign = { id: 1, aiContent: {} } as unknown as Campaign

describe('AddScriptStep', () => {
  it('starts on the chooser when initialScriptText is absent', async () => {
    render(<AddScriptStep campaign={campaign} backCallback={vi.fn()} />)

    expect(
      await screen.findByRole('heading', { name: 'Add a script' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Choose an option')).toBeInTheDocument()
  })

  it('starts on the write-your-own screen with the text seeded when initialScriptText is set', async () => {
    render(
      <AddScriptStep
        campaign={campaign}
        backCallback={vi.fn()}
        initialScriptText="Hello voters"
      />,
    )

    expect(
      await screen.findByRole('heading', { name: 'Add your script' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('Hello voters')
  })

  it('returns to the chooser from the seeded write-your-own screen via Back', async () => {
    render(
      <AddScriptStep
        campaign={campaign}
        backCallback={vi.fn()}
        initialScriptText="Hello voters"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Add a script' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('Choose an option')).toBeInTheDocument()
  })

  it('calls onComplete with the seeded (possibly edited) script on Next', async () => {
    const onComplete = vi.fn()
    render(
      <AddScriptStep
        campaign={campaign}
        backCallback={vi.fn()}
        initialScriptText="Hello voters"
        onComplete={onComplete}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Hello voters, see you Tuesday' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith('Hello voters, see you Tuesday'),
    )
  })
})
