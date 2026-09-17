import type { StorybookConfig } from '@storybook/nextjs-vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  stories: ['../../styleguide/src/stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  // No staticDirs: the vite builder leaves vite's own publicDir at its default
  // (<root>/public), so vite already copies this exact tree into the output.
  // Declaring it here too made storybook's fs.cp and vite's copy write the same
  // destination concurrently — they run in one Promise.all — and fs.cp stats a
  // directory before mkdir'ing it without `recursive`, so whichever lost the
  // race died with EEXIST. Re-adding this means re-adding that race.
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
