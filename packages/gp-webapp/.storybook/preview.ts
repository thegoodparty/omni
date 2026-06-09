import type { Preview } from '@storybook/nextjs-vite'
import React from 'react'
import '../app/globals.css'

const preview: Preview = {
  globalTypes: {
    colorScheme: {
      description: 'Color scheme',
      toolbar: {
        title: 'Color scheme',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  globals: {
    colorScheme: 'light',
  },
  decorators: [
    (Story, context) => {
      const isDark = context.globals['colorScheme'] === 'dark'
      return React.createElement(
        'div',
        {
          'data-slot': 'storybook',
          className: isDark ? 'dark' : undefined,
          style: {
            padding: '1.5rem',
            backgroundColor: 'var(--color-background)',
          },
        },
        React.createElement(Story),
      )
    },
  ],
  parameters: {
    backgrounds: { disable: true },
    layout: 'fullscreen',
    options: {
      storySort: {
        order: [
          'Foundations',
          [
            'Borders',
            'Colors',
            'Icons',
            'Logo',
            'Shadows',
            'Spacing',
            'Typography',
          ],
          'Components',
          'Campaign Plan',
        ],
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
}

export default preview
