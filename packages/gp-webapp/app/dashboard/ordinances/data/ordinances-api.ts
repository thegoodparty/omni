'use client'

import { clientRequest } from 'gpApi/typed-request'
import type {
  CreateOrdinanceRequest,
  Ordinance,
  SaveOrdinanceClarifyAnswerRequest,
} from '@goodparty_org/contracts'

export async function fetchOrdinanceBySlug(slug: string): Promise<Ordinance> {
  const { data } = await clientRequest('GET /v1/ordinances/:slug', { slug })
  return data
}

export async function createOrdinance(
  input: CreateOrdinanceRequest,
): Promise<Ordinance> {
  const { data } = await clientRequest('POST /v1/ordinances', input)
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
