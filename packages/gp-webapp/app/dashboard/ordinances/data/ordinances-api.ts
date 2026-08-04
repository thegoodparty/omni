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
  // Free the object URL only after the browser has had time to read the blob.
  // Revoking too soon after click() cancels the download in current Chrome and
  // surfaces as a spurious network error, worse for these larger PDF/Word blobs
  // than for a small CSV. Matches the poll download fix (ENG-10860).
  setTimeout(() => URL.revokeObjectURL(url), 10000)
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
