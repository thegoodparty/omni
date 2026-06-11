import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { queryClientConfig } from '@shared/query-client'
import { render as _render, RenderOptions } from '@testing-library/react'

// Disable retries in tests: the prod config retries failed queries with
// exponential backoff, which would make error-path tests wait seconds and race
// to flaky failures on loaded CI. Tests must see the failure immediately.
export const testQueryClient = new QueryClient({
  ...queryClientConfig,
  defaultOptions: {
    ...queryClientConfig.defaultOptions,
    queries: {
      ...queryClientConfig.defaultOptions?.queries,
      retry: false,
    },
  },
})

const TestProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <QueryClientProvider client={testQueryClient}>
      {children}
    </QueryClientProvider>
  )
}

export const render = (
  ui: React.ReactNode,
  options?: Omit<RenderOptions, 'queries' | 'wrapper'> | undefined,
) => _render(ui, { ...options, wrapper: TestProvider })
