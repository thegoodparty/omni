'use client'

import NextError from 'next/error'
import { useEffect } from 'react'
import { reportClientError } from '@shared/observability/reportClientError'

const GlobalError = ({ error }: { error: Error & { digest?: string } }) => {
  useEffect(() => {
    reportClientError(error)
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
