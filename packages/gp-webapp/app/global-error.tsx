'use client'

import NextError from 'next/error'
import { useEffect } from 'react'
import { reportErrorToSentry } from '@shared/sentry'

const GlobalError = ({ error }: { error: Error & { digest?: string } }) => {
  useEffect(() => {
    reportErrorToSentry(error)
  }, [error])

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  )
}

export default GlobalError
