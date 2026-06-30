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
  const text = sanitizeHtml(bio, { allowedTags: [], allowedAttributes: {} })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
  return text.length > 0 ? text : null
}
