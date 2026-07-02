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
  let parentObserver: MutationObserver | undefined
  try {
    parentObserver = new MutationObserver(syncFromParent)
    parentObserver.observe(window.parent.document.body, {
      attributes: true,
      attributeFilter: ['class'],
    })
  } catch {
    // cross-origin — skip
  }
  // Disconnect on HMR so reloads don't stack observers on the parent frame.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => parentObserver?.disconnect())
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
        // Radix portals (dropdown, select, popover, tooltip) mount to
        // document.body — outside the story wrapper below — so the wrapper's
        // `.dark` class never reaches them and the scoped dark-mode tokens
        // (`.dark [data-slot]…`) don't apply. Toggling `.dark` on body too lets
        // portaled content pick up dark mode like the rest of the story.
        document.body.classList.toggle('dark', isDark)
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
        method: 'alphabetical',
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
