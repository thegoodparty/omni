import sanitize from 'sanitize-html'

// Candidate-authored content (bio, key-issue descriptions) is untrusted input
// rendered on a public site via dangerouslySetInnerHTML. Sanitize so authored
// rich-text markup renders while scripts/handlers/javascript: URLs are stripped.
//
// Uses sanitize-html (pure JS) rather than DOMPurify: AboutSection sanitizes
// during SSR, and DOMPurify's server path pulls jsdom, whose dynamic require of
// xhr-sync-worker.js is dropped by Vercel's serverless file tracing and 500s the
// route at render time. sanitize-html has no DOM dependency and runs identically
// on the server. Allowlist matches the Quill editor output (formatting tags,
// lists, headings, links, alignment classes, inline color).
const options: sanitize.IOptions = {
  allowedTags: [
    'p',
    'br',
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'pre',
    'code',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['style'],
    p: ['style'],
    '*': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedStyles: {
    '*': {
      color: [/.*/],
      'background-color': [/.*/],
      'text-align': [/^(left|right|center|justify)$/],
    },
  },
}

export const sanitizeHtml = (dirty: string): string => sanitize(dirty, options)
