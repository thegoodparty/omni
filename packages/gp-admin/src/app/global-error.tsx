'use client'

import NextError from 'next/error'

const GlobalError = () => (
  <html>
    <body>
      <NextError statusCode={0} />
    </body>
  </html>
)

export default GlobalError
