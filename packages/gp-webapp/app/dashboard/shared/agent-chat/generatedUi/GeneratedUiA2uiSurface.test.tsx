import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  GENERATED_UI_A2UI_CATALOG_ID,
  type PresentGeneratedUiA2ui,
} from '@goodparty_org/contracts'
import GeneratedUiA2uiSurface, {
  messageFromA2uiAction,
} from './GeneratedUiA2uiSurface'

const action = (context: Record<string, unknown>, name = 'send_message') => ({
  name,
  surfaceId: 's',
  sourceComponentId: 'c',
  timestamp: '2026-10-29T00:00:00Z',
  context,
})

describe('messageFromA2uiAction', () => {
  it('sends text as written', () => {
    expect(messageFromA2uiAction(action({ text: ' Hi there ' }))).toBe(
      'Hi there',
    )
  })

  it('joins choices the way a clarify answer reads', () => {
    expect(
      messageFromA2uiAction(action({ choices: ['Text', 'Calls', 'Doors'] })),
    ).toBe('Text, Calls, and Doors')
  })

  it('ignores any other event', () => {
    expect(messageFromA2uiAction(action({ text: 'x' }, 'other'))).toBeNull()
  })
})

const payload: PresentGeneratedUiA2ui = {
  messages: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 's',
        catalogId: GENERATED_UI_A2UI_CATALOG_ID,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [
          { id: 'root', component: 'Stack', children: ['who', 'q'] },
          { id: 'who', component: 'ContactCard', name: { path: '/name' } },
          {
            id: 'q',
            component: 'ChoiceQuestion',
            question: 'Which?',
            options: ['Text', 'Calls'],
            multi: true,
            value: { path: '/picked' },
            submit: {
              event: {
                name: 'send_message',
                context: { choices: { path: '/picked' } },
              },
            },
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 's',
        path: '/',
        value: { name: 'Jane Rivera', picked: [] },
      },
    },
  ],
}

describe('GeneratedUiA2uiSurface', () => {
  it('renders bound values and sends what the user picked', async () => {
    const onMessage = vi.fn()
    render(<GeneratedUiA2uiSurface payload={payload} onMessage={onMessage} />)

    expect(await screen.findByText('Jane Rivera')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about them' }))
    await vi.waitFor(() =>
      expect(onMessage).toHaveBeenCalledWith(
        'What should I know about Jane Rivera?',
      ),
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Calls' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use these' }))
    await vi.waitFor(() =>
      expect(onMessage).toHaveBeenCalledWith('Text and Calls'),
    )
  })
})
