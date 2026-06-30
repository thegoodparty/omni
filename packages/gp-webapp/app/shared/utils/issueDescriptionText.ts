import { stripHtml } from 'string-strip-html'

// WebsiteIssue descriptions are Quill HTML. string-strip-html decodes entities
// before stripping, so "fund &lt;$50M" becomes "fund <$50M" and then "<$50M"
// is dropped as a malformed tag. Skip its decoding and decode the common
// entities ourselves afterward (& last, so a literal "&amp;lt;" doesn't
// collapse). Shared by every surface that renders a website issue as plain text.
export const issueDescriptionText = (description: string): string =>
  stripHtml(description, { skipHtmlDecoding: true })
    .result.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
