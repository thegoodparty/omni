'use client'
import {
  QueryClient,
  QueryClientConfig,
  QueryClientProvider,
} from '@tanstack/react-query'
import { useState } from 'react'
import { isUnauthorizedError } from 'gpApi/unauthorized'

export const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      // Total of 3 attempts (1 initial + 2 retries), except for a 401: the
      // session it is missing does not come back between attempts, and the
      // request layer is already sending the user to sign in, so retrying only
      // triples the failed requests on a page (ENG-11674).
      retry: (failureCount, error) =>
        failureCount < 2 && !isUnauthorizedError(error),
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
    },
    mutations: {
      // in an abundance of caution, do NOT retry failed mutations for now.
      retry: false,
    },
  },
}

export const ReactQueryProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [queryClient] = useState(() => new QueryClient(queryClientConfig))
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
