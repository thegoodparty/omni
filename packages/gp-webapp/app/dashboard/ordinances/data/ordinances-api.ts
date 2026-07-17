'use client'

import { clientRequest } from 'gpApi/typed-request'
import type {
  CreateOrdinanceRequest,
  Ordinance,
  SaveOrdinanceClarifyAnswerRequest,
  UpdateOrdinanceRequest,
} from '@goodparty_org/contracts'

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
