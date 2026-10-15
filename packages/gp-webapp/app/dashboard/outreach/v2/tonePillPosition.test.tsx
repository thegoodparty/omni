import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { SmsComposeStep } from './sms/SmsComposeStep'
import { ComposeStep } from './social/ComposeStep'
import { ScriptStep } from './phone-banking/ScriptStep'
import { RobocallComposeStep } from './robocall/RobocallComposeStep'

const expectPillsAboveMessage = (messageLabel: string) => {
  const pill = screen.getByText('Warm')
  const message = screen.getByRole('textbox', { name: messageLabel })
  expect(
    pill.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
}

describe('tone pills sit above the message', () => {
  it('on the SMS compose step', () => {
    render(
      <SmsComposeStep
        isServe={false}
        tone="warm"
        onToneChange={vi.fn()}
        standardsFailures={[]}
        unfilledBrackets={[]}
        identificationExample="Hi, it's Sarah"
        message="Hi {first_name}, it's Sarah."
        onMessageChange={vi.fn()}
        protectedParts={[]}
        mergeTagChannel="peerly"
        hasWrittenBody
        composedLength={28}
        aiAction="regenerate"
        onAiAction={vi.fn()}
        isDrafting={false}
        isDraftError={false}
        canUndo={false}
        onUndo={vi.fn()}
        imagePreviewUrl={null}
        onImageChange={vi.fn()}
        imageError={null}
        onImageError={vi.fn()}
        continueAttempts={0}
      />,
    )
    expectPillsAboveMessage('Message body')
  })

  it('on the social compose step', () => {
    render(
      <ComposeStep
        tone="warm"
        onToneChange={vi.fn()}
        draft="Come out Saturday."
        onDraftChange={vi.fn()}
        onRegenerate={vi.fn()}
        onImprove={vi.fn()}
        onRetry={vi.fn()}
        canImprove={false}
        isDrafting={false}
        isDraftError={false}
        canUndo={false}
        onUndo={vi.fn()}
        isCustomPurpose={false}
      />,
    )
    expectPillsAboveMessage('Draft message')
  })

  it('on the phone banking script step', () => {
    render(
      <ScriptStep
        isServe={false}
        name="Saturday calls"
        onNameChange={vi.fn()}
        audienceLabel="likely voters"
        tone="warm"
        onToneChange={vi.fn()}
        script="Hi, this is Sarah."
        onScriptChange={vi.fn()}
        instructions=""
        onInstructionsChange={vi.fn()}
        onRegenerate={vi.fn()}
        onImprove={vi.fn()}
        onRetry={vi.fn()}
        canImprove={false}
        isDrafting={false}
        isDraftError={false}
        isCustomPurpose={false}
      />,
    )
    expectPillsAboveMessage('Call script')
  })

  it('on the robocall compose step', () => {
    render(
      <RobocallComposeStep
        tone="warm"
        onToneChange={vi.fn()}
        script="This is Sarah, running for City Council."
        onScriptChange={vi.fn()}
        protectedParts={[]}
        hasWrittenBody
        aiAction="regenerate"
        onAiAction={vi.fn()}
        isDrafting={false}
        isDraftError={false}
        callbackNumber="+15125550123"
        isRentingNumber={false}
        rentError={false}
        onRetryNumber={vi.fn()}
        recorder={{
          status: 'idle',
          elapsedSec: 0,
          recording: null,
          error: null,
          start: vi.fn(),
          stop: vi.fn(),
          discard: vi.fn(),
          save: vi.fn(),
          uploadFile: vi.fn(),
          reset: vi.fn(),
        }}
        maxSeconds={60}
        onSaveRecording={vi.fn()}
        scriptChangedSinceRecording={false}
        isUploading={false}
        uploadError={null}
        complianceChecking={false}
        complianceVerdict={null}
        complianceError={false}
        onRetryCompliance={vi.fn()}
      />,
    )
    expectPillsAboveMessage('Robocall script')
  })
})
