'use client'

import { clientRequest } from 'gpApi/typed-request'
import type {
  CreateOrdinanceRequest,
  Ordinance,
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
