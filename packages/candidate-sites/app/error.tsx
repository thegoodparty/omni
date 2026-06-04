'use client'

import { useEffect } from 'react'

// App Router error boundary for the public site. Without it, any error thrown
// during render (e.g. a server-side dependency failing) surfaces as a bare 500
// with a half-streamed page. This degrades gracefully and surfaces the error to
// Vercel logs so render regressions are diagnosable.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('candidate-site render error', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>
        Something went wrong
      </h1>
      <p style={{ color: '#555' }}>
        This page could not be loaded. Please try again.
      </p>
      <button
        onClick={reset}
        style={{
          padding: '0.5rem 1.25rem',
          borderRadius: '0.5rem',
          border: '1px solid #ccc',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  )
}
