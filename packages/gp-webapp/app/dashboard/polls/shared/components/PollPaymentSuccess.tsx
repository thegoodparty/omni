'use client'
import React, { useEffect, useState } from 'react'
import H1 from '@shared/typography/H1'
import { Card, CardContent, ConfettiBurst } from '@styleguide'
import { CheckIcon } from '@styleguide/components/ui/icons'
import { LuSmartphone } from 'react-icons/lu'
import Body1 from '@shared/typography/Body1'
import { numberFormatter } from 'helpers/numberHelper'
import { PRICE_PER_POLL_TEXT } from '../constants'
import { dateUsHelper } from 'helpers/dateHelper'
import { useRouter } from 'next/navigation'

export type PollPaymentSuccesProps = {
  className?: string
  scheduledDate: Date
  textsPaidFor: number
  redirectTo: string
}

const REDIRECT_DELAY = 4 * 1000

export const PollPaymentSuccess: React.FC<PollPaymentSuccesProps> = ({
  className,
  scheduledDate,
  textsPaidFor,
  redirectTo,
}) => {
  const router = useRouter()
  const [celebrate, setCelebrate] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => {
      router.push(redirectTo)
    }, REDIRECT_DELAY)
    return () => clearTimeout(timeout)
  }, [])

  // A beat after mount rather than immediately, so the burst is not already
  // half over by the time the page finishes painting.
  useEffect(() => {
    const timeout = setTimeout(() => setCelebrate(true), 150)
    return () => clearTimeout(timeout)
  }, [])

  return (
    <div className={className}>
      {/* Sized to the burst, which overflows its 24px center box. */}
      <div className="flex h-20 w-20 mx-auto mb-6 items-center justify-center">
        <ConfettiBurst play={celebrate}>
          <CheckIcon className="h-5 w-5 text-primary" />
        </ConfettiBurst>
      </div>
      <H1 className="text-center mb-8">Payment successful!</H1>
      <Card>
        <CardContent>
          <div className="flex  items-center gap-2">
            <div className="bg-green-100 flex items-center justify-center rounded-full w-12 h-12">
              <LuSmartphone size={24} />
            </div>
            <div>
              <Body1 className="font-semibold">Text message campaign</Body1>
              <Body1 className="text-gray-700">
                Send date: {dateUsHelper(scheduledDate)} at 11:00 AM
              </Body1>
            </div>
          </div>
          <div className="mt-8 pb-8 border-t border-slate-200" />
          <div className="flex items-center justify-between">
            <Body1 className="font-semibold  text-xl">Total</Body1>
            <Body1 className="font-semibold text-xl">
              ${numberFormatter(PRICE_PER_POLL_TEXT * textsPaidFor, 2)}
            </Body1>
          </div>
        </CardContent>
      </Card>
      <div className="text-center text-blue-600 mt-8">
        You will be taken to your poll momentarily...
      </div>
    </div>
  )
}
