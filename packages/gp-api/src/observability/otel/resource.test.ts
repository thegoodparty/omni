import { describe, expect, it } from 'vitest'
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions'
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating'
import { otelResourceAttributes } from './resource'

describe('otelResourceAttributes', () => {
  it('identifies the service and environment on both resources', () => {
    for (const includeInstanceId of [true, false]) {
      const attributes = otelResourceAttributes({ includeInstanceId })
      expect(attributes[ATTR_SERVICE_NAME]).toBe('gp-api')
      expect(attributes[ATTR_DEPLOYMENT_ENVIRONMENT_NAME]).toBe(
        process.env.OTEL_SERVICE_ENVIRONMENT || 'local',
      )
    }
  })

  // Not a tautology: dropping this from the metric resource is what made every
  // task's cumulative counters alias onto one Prometheus series, so increase()
  // read each oscillation as a reset and returned 1702 on a series that ran
  // 1..3 over 24h.
  it('keeps service.instance.id on metrics and traces so cumulative counters stay addable', () => {
    const attributes = otelResourceAttributes({ includeInstanceId: true })
    expect(Object.keys(attributes)).toContain(ATTR_SERVICE_INSTANCE_ID)
    expect(attributes[ATTR_SERVICE_INSTANCE_ID]).toBeTruthy()
  })

  it('omits service.instance.id from logs, which Loki would promote to a stream label', () => {
    const attributes = otelResourceAttributes({ includeInstanceId: false })
    expect(Object.keys(attributes)).not.toContain(ATTR_SERVICE_INSTANCE_ID)
  })
})
