'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import AgentRunDetail from '../../shared/AgentRunDetail'
import type { AgentRun } from '../../shared/agent-run'

// Job-agnostic agent-run viewer. Reads /api/dev/runs/[id] (which parses the
// run's session.jsonl + milestones.jsonl server-side) and renders the reusable
// AgentRunDetail. Any CAP job's run can be viewed here by its runId.
const DevAgentRunPage = () => {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [run, setRun] = useState<AgentRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/dev/runs/${id}`)
      .then(async (res) => {
        const data = (await res.json()) as { run?: AgentRun; error?: string }
        if (!res.ok || !data.run) {
          throw new Error(data.error ?? `HTTP ${res.status}`)
        }
        setRun(data.run)
      })
      .catch((e) => setError(String(e)))
  }, [id])

  if (process.env.NODE_ENV !== 'development') {
    return <p className="p-8">Not available in production.</p>
  }

  return (
    <div className="min-h-svh bg-muted pb-20">
      <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 lg:px-8">
        <Link
          href="/dev/briefings"
          className="text-sm text-muted-foreground underline"
        >
          ← Back to gallery
        </Link>
      </div>
      {error ? (
        <p className="p-8">Failed to load run: {error}</p>
      ) : !run ? (
        <p className="p-8">Loading run…</p>
      ) : (
        <AgentRunDetail run={run} runId={id} />
      )}
    </div>
  )
}

export default DevAgentRunPage
