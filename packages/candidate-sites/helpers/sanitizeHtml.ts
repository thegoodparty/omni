import sanitize from 'sanitize-html'

// Candidate-authored content (bio, key-issue descriptions) is untrusted input
// rendered on a public site via dangerouslySetInnerHTML. Sanitize so authored
// rich-text markup renders while scripts/handlers/javascript: URLs are stripped.
//
// Uses sanitize-html (pure JS) rather than DOMPurify: AboutSection sanitizes
// during SSR, and DOMPurify's server path pulls jsdom, whose dependency chain
// (html-encoding-sniffer -> the now ESM-only @exodus/bytes) throws
// ERR_REQUIRE_ESM under Vercel's serverless runtime and 500s the route at render
// time. sanitize-html has no DOM dependency and runs identically on the server.
//
// Allowlist matches the Quill editor output (formatting tags, lists, headings,
// links, images, alignment, inline color). `style` is enabled on '*' because
// allowedStyles only takes effect on tags that admit the style attribute, and
// Quill emits inline styles on block tags too (e.g. <h1 style="text-align:...">).
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
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    '*': ['class', 'style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // Quill inlines inserted images as base64 data: URLs, so img src must allow
  // data: — scoped to img only, never to href, where data: enables phishing.
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowedStyles: {
    '*': {
      color: [/.*/],
      'background-color': [/.*/],
      'text-align': [/^(left|right|center|justify)$/],
    },
  },
  // Candidate-authored links with target="_blank" must carry rel="noopener
  // noreferrer" so the opened page can't reach window.opener (tabnabbing).
  transformTags: {
    a: (tagName, attribs) =>
      attribs.target === '_blank'
        ? { tagName, attribs: { ...attribs, rel: 'noopener noreferrer' } }
        : { tagName, attribs },
  },
}

export const sanitizeHtml = (dirty: string): string => sanitize(dirty, options)
