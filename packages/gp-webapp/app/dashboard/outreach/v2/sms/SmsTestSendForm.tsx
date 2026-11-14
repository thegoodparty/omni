'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Button, Input } from '@styleguide'
import type { CandidateSmsTestResponse } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useUser } from '@shared/hooks/useUser'
import { isValidPhone } from '@shared/inputs/PhoneInput'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

export const SMS_TEST_MAX_PHONES = 5

type TestResult = CandidateSmsTestResponse['results'][number]

// gp-api answers with 10-digit numbers, so results only match what we send
// when we send that same form.
const toNational = (value: string): string => {
  const digits = value.replace(/\D/g, '')
  return digits.length === 11 ? digits.slice(1) : digits
}

const resultLabel = (r: TestResult): string => {
  if (r.result === 'sent') return 'Sent'
  if (r.result === 'not_cell') return 'Not a cell number'
  return r.message ?? "Couldn't send. Try again."
}

const overallResult = (results: TestResult[]): string => {
  const first = results[0]?.result ?? 'failed'
  return results.every((r) => r.result === first) ? first : 'mixed'
}

interface SmsTestSendFormProps {
  outreachId: number
  surface: 'confirmation' | 'drawer'
  // False while the text is still being set up; the field stays disabled.
  ready?: boolean
}

export const SmsTestSendForm = ({
  outreachId,
  surface,
  ready = true,
}: SmsTestSendFormProps) => {
  const [user] = useUser()
  const [phones, setPhones] = useState<string[]>([user?.phone ?? ''])
  const [results, setResults] = useState<(TestResult | null)[]>([])
  const [notReady, setNotReady] = useState(false)

  const sendMutation = useMutation({
    mutationFn: async (sent: string[]) => {
      const { data } = await clientRequest('POST /v1/outreach/:id/sms/test', {
        id: String(outreachId),
        phones: sent,
      })
      return data
    },
  })

  const valid = phones.every(isValidPhone)
  const disabled = !ready || sendMutation.isPending

  const send = () => {
    const sent = phones.map(toNational)
    const distinct = [...new Set(sent)]
    setNotReady(false)
    setResults([])
    sendMutation.mutate(distinct, {
      onSuccess: (data) => {
        setResults(
          sent.map(
            (phone) => data.results.find((r) => r.phone === phone) ?? null,
          ),
        )
        trackEvent(EVENTS.Outreach.SmsTestCompleted, {
          surface,
          product: 'win',
          numberCount: distinct.length,
          result: overallResult(data.results),
        })
      },
      onError: (error) => {
        if (error instanceof FetchError && error.status === 409) {
          setNotReady(true)
          return
        }
        trackEvent(EVENTS.Outreach.SmsTestCompleted, {
          surface,
          product: 'win',
          numberCount: distinct.length,
          result: 'failed',
        })
        setResults(
          sent.map((phone) => ({
            phone,
            result: 'failed',
            message: "Couldn't send. Try again.",
          })),
        )
      },
    })
  }

  return (
    <div className="space-y-3 text-left">
      <div className="space-y-1">
        <p className="font-medium text-foreground">Send a test</p>
        <p className="text-sm text-muted-foreground">
          {ready && !notReady
            ? 'Text yourself to see how your message looks on a phone.'
            : 'Your text is still getting ready, so try again in a minute.'}
        </p>
      </div>
      <ul className="space-y-2">
        {phones.map((phone, i) => (
          <li key={i} className="space-y-1">
            <Input
              type="tel"
              inputMode="tel"
              aria-label={`Phone number ${i + 1}`}
              placeholder="(555) 555-5555"
              value={phone}
              disabled={disabled}
              onChange={(e) =>
                setPhones(phones.map((p, j) => (j === i ? e.target.value : p)))
              }
            />
            {results[i] && (
              <p
                role="status"
                className={
                  results[i]?.result === 'sent'
                    ? 'text-sm text-muted-foreground'
                    : 'text-sm text-destructive'
                }
              >
                {resultLabel(results[i] as TestResult)}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || phones.length >= SMS_TEST_MAX_PHONES}
          onClick={() => setPhones([...phones, ''])}
        >
          Add a number
        </Button>
        <Button type="button" disabled={disabled || !valid} onClick={send}>
          Send a test
        </Button>
      </div>
    </div>
  )
}
