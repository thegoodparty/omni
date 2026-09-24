import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { PRO_UPGRADE_STEP } from '../proUpgradeStep'
import { useProUpgradeWizard } from './proUpgradeWizardContext'

// The real steps fetch and render heavy forms; a probe that reads the context
// keeps this suite about the flow's own state machine.
vi.mock('./proUpgradeStepComponents', () => {
  const Probe = ({ label }: { label: string }) => {
    const {
      goToNextStep,
      goToPreviousStep,
      exit,
      complete,
      purchaseOnly,
      channel,
    } = useProUpgradeWizard()
    return (
      <div>
        <span>{label}</span>
        <span>purchaseOnly:{String(purchaseOnly)}</span>
        <span>channel:{channel ?? 'none'}</span>
        <button onClick={goToNextStep}>next</button>
        <button onClick={goToPreviousStep}>back</button>
        <button onClick={exit}>exit</button>
        <button onClick={complete}>complete</button>
      </div>
    )
  }
  return {
    PRO_UPGRADE_STEP_COMPONENTS: {
      'value-prop': () => <Probe label="step:value-prop" />,
      status: () => <Probe label="step:status" />,
      'filing-instructions': () => <Probe label="step:filing-instructions" />,
      guidance: () => <Probe label="step:guidance" />,
      ein: () => <Probe label="step:ein" />,
      'filing-details': () => <Probe label="step:filing-details" />,
      'candidate-profile': () => <Probe label="step:candidate-profile" />,
      payment: () => <Probe label="step:payment" />,
      success: () => <Probe label="step:success" />,
      interstitial: () => <Probe label="step:interstitial" />,
    },
  }
})

import ProUpgradeFlow from './ProUpgradeFlow'

describe('ProUpgradeFlow', () => {
  it('renders the initial step in purchase-only mode with the launch channel', () => {
    render(
      <ProUpgradeFlow
        initialStep={PRO_UPGRADE_STEP.GUIDANCE}
        channel="sms"
        onExit={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText('step:guidance')).toBeInTheDocument()
    expect(screen.getByText('purchaseOnly:true')).toBeInTheDocument()
    expect(screen.getByText('channel:sms')).toBeInTheDocument()
  })

  it('walks the purchase-only order forward and back in state', () => {
    render(
      <ProUpgradeFlow
        initialStep={PRO_UPGRADE_STEP.GUIDANCE}
        onExit={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('next'))
    expect(screen.getByText('step:status')).toBeInTheDocument()
    fireEvent.click(screen.getByText('next'))
    expect(screen.getByText('step:ein')).toBeInTheDocument()
    fireEvent.click(screen.getByText('back'))
    expect(screen.getByText('step:status')).toBeInTheDocument()
  })

  it('exits from the first step on back, and forwards exit/complete', () => {
    const onExit = vi.fn()
    const onComplete = vi.fn()
    render(
      <ProUpgradeFlow
        initialStep={PRO_UPGRADE_STEP.GUIDANCE}
        onExit={onExit}
        onComplete={onComplete}
      />,
    )

    fireEvent.click(screen.getByText('back'))
    expect(onExit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('complete'))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('continues from the interstitial into guidance, never by index', () => {
    render(
      <ProUpgradeFlow
        initialStep={PRO_UPGRADE_STEP.INTERSTITIAL}
        channel="sms"
        onExit={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText('step:interstitial')).toBeInTheDocument()

    fireEvent.click(screen.getByText('next'))

    expect(screen.getByText('step:guidance')).toBeInTheDocument()
  })

  it('exits from the interstitial on back, since it is off the purchase-only order', () => {
    const onExit = vi.fn()
    render(
      <ProUpgradeFlow
        initialStep={PRO_UPGRADE_STEP.INTERSTITIAL}
        channel="sms"
        onExit={onExit}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('back'))

    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
