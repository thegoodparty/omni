'use client'

import { useEffect, useState } from 'react'
import { Card } from '@styleguide'
import { Loader2Icon } from '@styleguide/components/ui/icons'

const THINKING_MESSAGES = [
  'Reading your message…',
  'Checking your campaign tone…',
  'Matching your message to each platform…',
  'Drafting content for each platform…',
]

// Client presentation only: the generate request is one synchronous call —
// this stream keeps the wait legible (phase 1 TDD: the "AI thinking stream"
// in the design is presentation during the request).
export const ThinkingStream = () => {
  const [index, setIndex] = useState(0)
  const [visibleText, setVisibleText] = useState('')

  useEffect(() => {
    const full = THINKING_MESSAGES[index] ?? ''
    let pos = 0
    setVisibleText('')
    const type = window.setInterval(() => {
      pos += 1
      setVisibleText(full.slice(0, pos))
      if (pos >= full.length) {
        window.clearInterval(type)
        window.setTimeout(
          () => setIndex((i) => (i + 1) % THINKING_MESSAGES.length),
          900,
        )
      }
    }, 45)
    return () => window.clearInterval(type)
  }, [index])

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-light">
          <Loader2Icon className="size-4 animate-spin text-primary" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium text-foreground">
            {visibleText}
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary align-middle" />
          </span>
          <span className="text-xs text-muted-foreground">
            AI is adapting your message
          </span>
        </div>
      </div>
    </Card>
  )
}
