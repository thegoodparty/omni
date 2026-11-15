import { describe, expect, it } from 'vitest'
import { deploymentEnvironment } from './deploymentEnvironment'

describe('deploymentEnvironment', () => {
  it('names the production target prod', () => {
    expect(
      deploymentEnvironment({
        vercelTargetEnv: 'production',
        apiBase: 'https://api.goodparty.org',
      }),
    ).toBe('prod')
  })

  it('names the main build on the preview target dev', () => {
    expect(
      deploymentEnvironment({
        vercelTargetEnv: 'preview',
        apiBase: 'https://gp-api-dev.goodparty.org',
      }),
    ).toBe('dev')
  })

  it('names a PR preview, baked against its own gp-api stack, preview', () => {
    expect(
      deploymentEnvironment({
        vercelTargetEnv: 'preview',
        apiBase: 'https://pr-3412.preview.goodparty.org',
      }),
    ).toBe('preview')
  })

  it('names a build with no Vercel target local', () => {
    expect(
      deploymentEnvironment({
        vercelTargetEnv: '',
        apiBase: 'http://localhost:3000',
      }),
    ).toBe('local')
  })
})
