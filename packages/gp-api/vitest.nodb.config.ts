import baseConfig from './vitest.config'

const cfg = baseConfig as Record<string, any>

export default {
  ...cfg,
  test: {
    ...cfg.test,
    globalSetup: [],
  },
}
