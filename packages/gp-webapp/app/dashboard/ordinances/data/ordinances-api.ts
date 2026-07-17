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
  SaveOrdinanceClarifyAnswerRequest,
  UpdateOrdinanceRequest,
} from '@goodparty_org/contracts'

export type OrdinanceExportFormat = 'pdf' | 'docx'

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
  URL.revokeObjectURL(url)
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

// Generate (or re-run) the draft's six-check quality report. Returns the
// updated ordinance with the fresh report.
export async function generateQualityReport(slug: string): Promise<Ordinance> {
  const { data } = await clientRequest(
    'POST /v1/ordinances/:slug/quality-report',
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
