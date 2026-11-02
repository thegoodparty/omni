// No 'use client': PriorityResultsView is a client component.
import { useQuery } from '@tanstack/react-query'
import { Button, DownloadIcon, Spinner } from '@styleguide'
import { API_VERSION_PREFIX } from 'appEnv'
import { clientRequest } from 'gpApi/typed-request'
import { SERVE_POLL_READER_COPY } from 'app/dashboard/outreach/v2/poll/results/pollResultsCopy'
import { RESULTS_COPY } from '../resultsCopy'

// A plain same-origin link, not a fetch: middleware.ts proxies /api/v1/* to
// gp-api, and the browser saves the CSV it sends back, the way the polls
// download (polls/[id]/components/DownloadResults.tsx) does.
export const PriorityCommentsDownload = ({
  priorityId,
  themeId,
}: {
  priorityId: string
  themeId?: string
}) => {
  const query = themeId ? `?themeId=${encodeURIComponent(themeId)}` : ''
  return (
    <Button asChild variant="outline" size="small">
      <a
        href={`/api${API_VERSION_PREFIX}/priorities/${encodeURIComponent(priorityId)}/results/comments/download${query}`}
        download
      >
        <DownloadIcon aria-hidden="true" />
        {themeId ? RESULTS_COPY.downloadTheme : RESULTS_COPY.downloadAll}
      </a>
    </Button>
  )
}

// What people said behind one theme, in the poll reader's list. Words only:
// no name, record or contact detail, so no heart, read mark or details.
export const PriorityThemeComments = ({
  priorityId,
  themeId,
}: {
  priorityId: string
  themeId: string
}) => {
  const query = useQuery({
    queryKey: ['priority-theme-comments', priorityId, themeId] as const,
    queryFn: () =>
      clientRequest('GET /v1/priorities/:id/results/themes/:themeId/comments', {
        id: priorityId,
        themeId,
      }).then((res) => res.data),
  })
  const comments = query.data?.comments ?? []

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">
        {SERVE_POLL_READER_COPY.responsesTitle}
      </h2>
      {query.isError ? (
        <p className="text-sm text-muted-foreground">
          {SERVE_POLL_READER_COPY.failed}
        </p>
      ) : query.isPending ? (
        <div className="flex items-center gap-3 py-6">
          <Spinner />
          <p className="text-sm text-muted-foreground">
            {SERVE_POLL_READER_COPY.loading}
          </p>
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {RESULTS_COPY.commentsEmpty}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ul>
            {comments.map((comment, index) => (
              // `block`: globals.css turns every <li> under a [data-slot]
              // ancestor into a flex row.
              <li
                key={index}
                className="block border-t border-border px-3 py-3 first:border-t-0"
              >
                {comment.kind === 'note' && (
                  <p className="text-xs text-muted-foreground">
                    {RESULTS_COPY.noteLabel}
                  </p>
                )}
                <p className="mt-1 text-sm whitespace-pre-line text-foreground first:mt-0">
                  {comment.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
