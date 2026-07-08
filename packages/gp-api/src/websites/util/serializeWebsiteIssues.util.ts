import sanitizeHtml from 'sanitize-html'

type WebsiteIssue = NonNullable<
  NonNullable<PrismaJson.WebsiteContent['about']>['issues']
>[number]

// The candidate's issues live on the website as { title, description } objects
// with HTML (Quill) descriptions. Consumers that want the old single plain-text
// "issues" string (the agents' campaign_story.issues, campaign-tracker
// personalization) flatten them here: strip tags, decode the common entities
// (& last, so a literal "&amp;lt;" doesn't collapse), and join title +
// description blocks. Returns null when there are no issues.
export const serializeWebsiteIssues = (
  issues: WebsiteIssue[],
): string | null => {
  const blocks = issues
    .map(({ title, description }) => {
      const cleanTitle = title?.trim() ?? ''
      const cleanDescription = description
        ? sanitizeHtml(description, {
            allowedTags: [],
            allowedAttributes: {},
          })
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .trim()
        : ''
      if (cleanTitle && cleanDescription) {
        return `${cleanTitle}\n${cleanDescription}`
      }
      return cleanTitle || cleanDescription
    })
    .filter((block) => block.length > 0)
  return blocks.length > 0 ? blocks.join('\n\n') : null
}
