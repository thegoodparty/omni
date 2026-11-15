import { describe, expect, it } from 'vitest'
import { GP_API_SECRET_KEYS } from './gp-api-secret-keys'

describe('GP_API_SECRET_KEYS', () => {
  it('gives previews no Grafana Cloud token, so they export nothing', () => {
    expect(GP_API_SECRET_KEYS.preview).not.toContain(
      'OTEL_EXPORTER_OTLP_HEADERS',
    )
  })

  it('gives previews every other dev key', () => {
    expect(GP_API_SECRET_KEYS.preview).toEqual(
      GP_API_SECRET_KEYS.dev.filter(
        (key) => key !== 'OTEL_EXPORTER_OTLP_HEADERS',
      ),
    )
  })

  it('keeps the Grafana Cloud token on dev and prod', () => {
    expect(GP_API_SECRET_KEYS.dev).toContain('OTEL_EXPORTER_OTLP_HEADERS')
    expect(GP_API_SECRET_KEYS.prod).toContain('OTEL_EXPORTER_OTLP_HEADERS')
  })
})
