'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Button, Input } from '@styleguide'
import { Trash2Icon } from '@styleguide/components/ui/icons'
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

const summaryText = (sent: number, total: number): string => {
  if (sent === total) {
    return `Test sent to ${total} ${total === 1 ? 'number' : 'numbers'}. Check your phone.`
  }
  if (sent === 0) return "We couldn't send your test. Try again."
  return `Test sent to ${sent} of ${total} numbers. Check the rest below.`
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
  const [summary, setSummary] = useState<string | null>(null)

  const sendMutation = useMutation({
    mutationFn: async (sent: string[]) => {
      const { data } = await clientRequest('POST /v1/outreach/:id/sms/test', {
        id: String(outreachId),
        phones: sent,
      })
      return data
    },
  })

  const filled = phones.filter((p) => p.trim() !== '')
  const valid = filled.length > 0 && filled.every(isValidPhone)
  const disabled = !ready || sendMutation.isPending

  const send = () => {
    const sent = phones.map((p) => (p.trim() === '' ? '' : toNational(p)))
    const distinct = [...new Set(sent.filter((p) => p !== ''))]
    setNotReady(false)
    setResults([])
    setSummary(null)
    sendMutation.mutate(distinct, {
      onSuccess: (data) => {
        setResults(
          sent.map(
            (phone) => data.results.find((r) => r.phone === phone) ?? null,
          ),
        )
        setSummary(
          summaryText(
            data.results.filter((r) => r.result === 'sent').length,
            distinct.length,
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
          sent.map((phone) =>
            phone === ''
              ? null
              : {
                  phone,
                  result: 'failed',
                  message: "Couldn't send. Try again.",
                },
          ),
        )
        setSummary(summaryText(0, distinct.length))
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
          <li key={i} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Input
                type="tel"
                inputMode="tel"
                aria-label={`Phone number ${i + 1}`}
                placeholder="(555) 555-5555"
                value={phone}
                disabled={disabled}
                onChange={(e) =>
                  setPhones(
                    phones.map((p, j) => (j === i ? e.target.value : p)),
                  )
                }
              />
              {i > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  aria-label={`Remove phone number ${i + 1}`}
                  disabled={disabled}
                  onClick={() => {
                    setPhones(phones.filter((_, j) => j !== i))
                    setResults([])
                    setSummary(null)
                  }}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
            </div>
            {results[i] && (
              <p
                role="status"
                className={
                  results[i]?.result === 'sent'
                    ? 'px-1 text-sm break-words text-muted-foreground'
                    : 'px-1 text-sm break-words text-destructive'
                }
              >
                {resultLabel(results[i] as TestResult)}
              </p>
            )}
          </li>
        ))}
      </ul>
      {summary && (
        <p aria-live="polite" className="text-sm font-medium text-foreground">
          {summary}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
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
