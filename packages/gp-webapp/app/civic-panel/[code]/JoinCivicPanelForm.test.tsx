import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { JoinCivicPanelForm } from './JoinCivicPanelForm'

const CODE = 'a1b2c3d4e5f6'

const renderForm = () =>
  render(
    <JoinCivicPanelForm
      code={CODE}
      title="Want a say before Dana Lee decides?"
      caption="Join the civic panel."
    />,
  )

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('First name'), 'Rosalind')
  await user.type(screen.getByLabelText('Last name'), 'Okafor')
  await user.type(screen.getByLabelText('Cell phone'), '(303) 555-0142')
}

describe('JoinCivicPanelForm', () => {
  it('joins only with consent, posting the name and number in the body', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    api.mock('POST /v1/civic-panel/join/:code', ({ body }) => {
      bodies.push(body)
      return { status: 200, data: { received: true } }
    })
    renderForm()

    await fill(user)
    const submit = screen.getByRole('button', { name: 'Join the civic panel' })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(submit)

    expect(await screen.findByText("You're on the list")).toBeInTheDocument()
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          firstName: 'Rosalind',
          lastName: 'Okafor',
          phone: '(303) 555-0142',
          consent: true,
        },
      ]),
    )
  })

  it('says what to do when the join fails', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/civic-panel/join/:code', {
      status: 400,
      data: { received: false },
    })
    renderForm()

    await fill(user)
    await user.click(screen.getByRole('checkbox'))
    await user.click(
      screen.getByRole('button', { name: 'Join the civic panel' }),
    )

    expect(
      await screen.findByText(
        "We couldn't save that. Check your number and try again.",
      ),
    ).toBeInTheDocument()
  })
})
