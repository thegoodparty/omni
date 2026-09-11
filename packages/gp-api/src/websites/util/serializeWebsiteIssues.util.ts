import sanitizeHtml from 'sanitize-html'

type WebsiteIssue = NonNullable<
  NonNullable<PrismaJson.WebsiteContent['about']>['issues']
>[number]

export interface PlainWebsiteIssue {
  title: string
  description: string
}

// The candidate's issues live on the website as { title, description } objects
// with HTML (Quill) descriptions. This is the one place that HTML is undone:
// strip tags, decode the common entities (& last, so a literal "&amp;lt;"
// doesn't collapse), and trim.
//
// Split out of `serializeWebsiteIssues` below because two consumers want two
// shapes of the same cleaning. That function wants one flat string; the
// compose prompts want the pairs, so they can print "- {title}: {position}"
// per issue and cap the list the way they cap every other block. Sanitizing in
// one place is the point — an issue reaching an LLM prompt with `<p>` tags
// around it spends context on markup and can drift into the output.
//
// Empty members are kept rather than dropped, because "title with no body" is
// a state the serializer below renders and the caller has to be able to see.
export const cleanWebsiteIssues = (
  issues: WebsiteIssue[],
): PlainWebsiteIssue[] =>
  issues.map(({ title, description }) => ({
    title: title?.trim() ?? '',
    description: description
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
      : '',
  }))

// Consumers that want the old single plain-text "issues" string (the agents'
// campaign_story.issues, campaign-tracker personalization) join the cleaned
// title + description blocks here. Returns null when there are no issues.
export const serializeWebsiteIssues = (
  issues: WebsiteIssue[],
): string | null => {
  const blocks = cleanWebsiteIssues(issues)
    .map(({ title, description }) =>
      title && description ? `${title}\n${description}` : title || description,
    )
    .filter((block) => block.length > 0)
  return blocks.length > 0 ? blocks.join('\n\n') : null
}
