import DOMPurify from 'isomorphic-dompurify'

// Candidate-authored content (bio, key-issue descriptions) is untrusted input
// rendered on a public site. Sanitize before any dangerouslySetInnerHTML so
// authored markup renders while scripts/handlers/javascript: URLs are stripped.
export const sanitizeHtml = (dirty: string): string => DOMPurify.sanitize(dirty)
