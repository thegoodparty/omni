'use client'
import { Button } from '@styleguide'
import Body1 from '@shared/typography/Body1'
import H1 from '@shared/typography/H1'
import Image from 'next/image'
import { useEffect } from 'react'
import Link from 'next/link'
import { reportClientError } from '@shared/observability/reportClientError'

interface ErrorPageProps {
  error: Error
}

export default function Error({ error }: ErrorPageProps): React.JSX.Element {
  useEffect(() => {
    reportClientError(error)
    if (error?.message?.startsWith('Loading chunk')) {
      window.location.reload()
    }
  }, [error])

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-3 lg:px-5">
      <div className="grid grid-cols-12 gap-4 items-center justify-center">
        <div className="col-span-12 lg:col-span-6 ">
          <div className="relative h-[50vh]">
            <Image
              src="/images/error-pages/error-500.svg"
              data-cy="logo"
              fill
              className="object-contain object-center"
              alt="Error"
              priority
            />
          </div>
        </div>

        <div className="col-span-12 lg:col-span-6">
          <H1>Error: 500 server error</H1>
          <Body1 className="my-7">
            Something went wrong. Our engineers are blaming the
            two-party-system.
          </Body1>
          <Button asChild>
            <Link href="/">Back to our homepage</Link>
          </Button>
          <div className="text-sm italic mt-12">{error?.message}</div>
        </div>
      </div>
    </div>
  )
}
