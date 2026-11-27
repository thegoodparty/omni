import { describe, expect, it } from 'vitest'
import { GP_API_SECRET_KEYS } from './gp-api-secret-keys'

const caseScoutWebhookKeys = [
  'CASE_SCOUT_DELEGATE_WEBHOOK_SECRET',
  'CASE_SCOUT_DELEGATE_WEBHOOK_URL',
]

describe('GP_API_SECRET_KEYS', () => {
  it('gives previews no Grafana Cloud token, so they export nothing', () => {
    expect(GP_API_SECRET_KEYS.preview).not.toContain(
      'OTEL_EXPORTER_OTLP_HEADERS',
    )
  })

  it('gives previews no Delegate webhook keys, since previews never send', () => {
    for (const key of caseScoutWebhookKeys) {
      expect(GP_API_SECRET_KEYS.preview).not.toContain(key)
    }
  })

  it('gives previews every other dev key', () => {
    const notOnPreview = ['OTEL_EXPORTER_OTLP_HEADERS', ...caseScoutWebhookKeys]
    expect(GP_API_SECRET_KEYS.preview).toEqual(
      GP_API_SECRET_KEYS.dev.filter((key) => !notOnPreview.includes(key)),
    )
  })

  it('declares the Delegate webhook keys on dev and prod', () => {
    for (const key of caseScoutWebhookKeys) {
      expect(GP_API_SECRET_KEYS.dev).toContain(key)
      expect(GP_API_SECRET_KEYS.prod).toContain(key)
    }
  })

  it('keeps the Grafana Cloud token on dev and prod', () => {
    expect(GP_API_SECRET_KEYS.dev).toContain('OTEL_EXPORTER_OTLP_HEADERS')
    expect(GP_API_SECRET_KEYS.prod).toContain('OTEL_EXPORTER_OTLP_HEADERS')
  })

  it('declares the Scale to Win keys on prod only', () => {
    const s2wKeys = [
      'S2W_API_KEY_ID',
      'S2W_API_KEY_SECRET',
      'S2W_SUBACCOUNT_ID',
    ]
    for (const key of s2wKeys) {
      expect(GP_API_SECRET_KEYS.prod).toContain(key)
      expect(GP_API_SECRET_KEYS.dev).not.toContain(key)
      expect(GP_API_SECRET_KEYS.preview).not.toContain(key)
    }
  })
})
