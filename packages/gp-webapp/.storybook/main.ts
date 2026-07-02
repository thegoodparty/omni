import type { StorybookConfig } from '@storybook/nextjs-vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  stories: ['../../styleguide/src/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  staticDirs: ['../public'],
  addons: ['@chromatic-com/storybook', '@storybook/addon-docs'],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  viteFinal: async (config) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string>),
      '@styleguide': path.resolve(__dirname, '../../styleguide/src'),
      '@shared': path.resolve(__dirname, '../app/shared'),
      // App-coupled stories (e.g. AiChat) import gp-webapp app modules by their
      // `app/...` path; the story files live in the styleguide package, so the
      // bare specifier needs an explicit alias to resolve here.
      app: path.resolve(__dirname, '../app'),
    }
    return config
  },
}

export default config
