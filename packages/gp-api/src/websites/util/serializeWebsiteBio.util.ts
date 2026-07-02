import sanitizeHtml from 'sanitize-html'

// The candidate's "why" lives on the website as the bio — Quill HTML (shared
// with the Pro-upgrade flow). Consumers that want the old plain-text
// campaign_story.why string (the agents' candidate platform, campaign-tracker
// personalization) flatten it here: strip tags, decode the common entities
// (& last, so a literal "&amp;lt;" doesn't collapse), and trim. Returns null
// when the bio is empty. Mirrors serializeWebsiteIssues for the single-string
// bio field.
export const serializeWebsiteBio = (
  bio: string | null | undefined,
): string | null => {
  if (!bio) return null
  // Insert a space before each closing block tag so adjacent blocks don't
  // concatenate ("<p>foo</p><p>bar</p>" -> "foo bar", not "foobar"). This
  // matches the webapp's string-strip-html spacing so the shared MIN_BIO_LENGTH
  // count agrees on both sides of the boundary.
  const spaced = bio.replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '</$1> ')
  const text = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
  return text.length > 0 ? text : null
}
