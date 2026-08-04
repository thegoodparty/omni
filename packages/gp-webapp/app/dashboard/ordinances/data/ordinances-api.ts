'use client'

import { clientRequest } from 'gpApi/typed-request'
import { getCookie } from 'helpers/cookieHelper'
import {
  ORG_SLUG_COOKIE,
  ORG_SLUG_HEADER,
} from '@shared/organizations/constants'
import type {
  CreateOrdinanceRequest,
  Ordinance,
  OrdinanceExportFormat,
  OrdinanceQualityIterationsResponse,
  OrdinanceQualityRun,
  SaveOrdinanceClarifyAnswerRequest,
  UpdateOrdinanceRequest,
} from '@goodparty_org/contracts'

export type { OrdinanceExportFormat }

// Download the exported draft (PDF/Word). The endpoint streams a binary file, so
// this bypasses the JSON typed client: fetch through the /api proxy with the org
// header the elected-office guard needs, then save the returned blob.
export async function downloadOrdinanceExport(
  slug: string,
  format: OrdinanceExportFormat,
): Promise<void> {
  const orgSlug = getCookie(ORG_SLUG_COOKIE)
  const res = await fetch(
    `/api/v1/ordinances/${slug}/export?format=${format}`,
    {
      credentials: 'include',
      headers: orgSlug ? { [ORG_SLUG_HEADER]: orgSlug } : {},
    },
  )
  if (!res.ok) throw new Error(`Export failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${slug}.${format}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Defer the revoke: the browser's download manager reads the blob URL
  // asynchronously, and revoking on the same tick can abort the download on
  // Safari / older Chromium (matches the other download helpers here).
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

// Flag a bug on the draft. Persists a bug_report annotation carrying the user's
// description and the flagged passage (excerpt). The anchor is resource-wide
// (all null) on purpose: the draft body is editable, so a positional anchor
// can't be trusted to re-find the passage later — the excerpt is the record.
export async function createOrdinanceBugReport(
  slug: string,
  input: { description: string; excerpt: string },
): Promise<void> {
  await clientRequest('POST /v1/ordinances/:slug/annotations', {
    slug,
    kind: 'bug_report',
    anchor: { json_path: null, start: null, end: null },
    payload: {
      description: input.description,
      excerpt: input.excerpt || undefined,
    },
  })
}

export async function fetchOrdinanceBySlug(slug: string): Promise<Ordinance> {
  const { data } = await clientRequest('GET /v1/ordinances/:slug', { slug })
  return data
}

// Patch the draft (title/body) or status. Partial: only the fields passed are
// written. Returns the updated ordinance so the caller can reconcile.
export async function updateOrdinance(
  slug: string,
  update: UpdateOrdinanceRequest,
): Promise<Ordinance> {
  const { data } = await clientRequest('PATCH /v1/ordinances/:slug', {
    slug,
    ...update,
  })
  return data
}

export async function deleteOrdinance(slug: string): Promise<void> {
  await clientRequest('DELETE /v1/ordinances/:slug', { slug })
}

export async function createOrdinance(
  input: CreateOrdinanceRequest,
): Promise<Ordinance> {
  const { data } = await clientRequest('POST /v1/ordinances', input)
  return data
}

// Start (or join) the async six-check quality run. Returns the run's current
// state immediately — 'running' means poll fetchQualityRun until it settles,
// 'done' means the server already had a fresh report and no run was started.
export async function startQualityReport(
  slug: string,
  opts?: { signal?: AbortSignal },
): Promise<OrdinanceQualityRun> {
  const { data } = await clientRequest(
    'POST /v1/ordinances/:slug/quality-report',
    { slug },
    opts?.signal ? { signal: opts.signal } : undefined,
  )
  return data
}

export async function fetchQualityRun(
  slug: string,
  opts?: { signal?: AbortSignal },
): Promise<OrdinanceQualityRun> {
  const { data } = await clientRequest(
    'GET /v1/ordinances/:slug/quality-report',
    { slug },
    opts?.signal ? { signal: opts.signal } : undefined,
  )
  return data
}

// The improvement loop has no client-side start: it auto-starts server-side
// on saveDraft (design: the panel only re-grades). The POST
// /v1/ordinances/:slug/quality-loop route still exists for API/ops use.
export async function cancelQualityLoop(slug: string): Promise<Ordinance> {
  const { data } = await clientRequest(
    'DELETE /v1/ordinances/:slug/quality-loop',
    { slug },
  )
  return data
}

// The latest loop run's per-pass history — the "what changed" panel's data.
export async function fetchQualityIterations(
  slug: string,
): Promise<OrdinanceQualityIterationsResponse> {
  const { data } = await clientRequest(
    'GET /v1/ordinances/:slug/quality-iterations',
    { slug },
  )
  return data
}

// Persist a clarify answer directly (the client is the source of truth), keyed
// by the widget's own questionId. Returns the updated ordinance so the caller
// can refresh its recorded answers.
export async function saveClarifyAnswer(
  slug: string,
  answer: SaveOrdinanceClarifyAnswerRequest,
): Promise<Ordinance> {
  const { data } = await clientRequest(
    'POST /v1/ordinances/:slug/clarify-answers',
    { slug, ...answer },
  )
  return data
}
