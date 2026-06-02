'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { AgentRunDetail } from '@goodparty_org/sdk'

const AgentRunContext = createContext<AgentRunDetail | null>(null)

export function AgentRunProvider({
  detail,
  children,
}: {
  detail: AgentRunDetail
  children: ReactNode
}) {
  return (
    <AgentRunContext.Provider value={detail}>
      {children}
    </AgentRunContext.Provider>
  )
}

export function useAgentRun(): AgentRunDetail {
  const context = useContext(AgentRunContext)
  if (!context) {
    throw new Error('useAgentRun must be used within an AgentRunProvider')
  }
  return context
}
