import type { Preview } from '@storybook/nextjs-vite'
import React from 'react'
import '../app/globals.css'
import './storybook-dark.css'

// For inline:false story iframes: sync dark mode from the parent Docs iframe.
// These iframes load without globals in their URL, so the decorator can't
// detect the active color scheme. We read the parent's body class directly
// (same-origin) and watch for changes via MutationObserver.
if (typeof window !== 'undefined' && window.parent !== window) {
  const syncFromParent = () => {
    try {
      const isDark = window.parent.document.body.classList.contains('dark')
      document.documentElement.classList.toggle('sb-dark', isDark)
      document.body.classList.toggle('dark', isDark)
    } catch {
      // cross-origin — skip
    }
  }
  syncFromParent()
  try {
    new MutationObserver(syncFromParent).observe(window.parent.document.body, {
      attributes: true,
      attributeFilter: ['class'],
    })
  } catch {
    // cross-origin — skip
  }
}

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
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('sb-dark', isDark)
        // Only override when globals are explicitly set — inline:false story
        // iframes have no globals, so we leave the class synced from parent.
        if (context.globals['colorScheme'] !== undefined) {
          document.body.classList.toggle('dark', isDark)
        }
      }
      return React.createElement(
        'div',
        { className: isDark ? 'dark' : undefined },
        React.createElement(
          'div',
          {
            'data-slot': 'storybook',
            style: { padding: '1.5rem' },
          },
          React.createElement(Story),
        ),
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
