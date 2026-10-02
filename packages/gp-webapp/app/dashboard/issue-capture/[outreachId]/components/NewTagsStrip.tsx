import { useId } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateIssueTag } from '@goodparty_org/contracts'
import { Button, TagIcon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachProduct } from 'app/dashboard/outreach/util/outreachAnalytics'
import { whatWeHeardCopy } from '../../copy'
import { PROPOSED_TAGS_QUERY_KEY, proposedTagsQueryOptions } from '../queries'

// A run proposes a tag per theme; a person decides. Accepting puts the tag
// on people's records, dismissing retires it. The tag list is the owner's
// and the manager's, so anyone the API refuses sees no strip at all rather
// than an error about something they were never meant to curate.
const NewTagsStrip = ({
  isServe,
  runId,
}: {
  isServe: boolean
  runId: string
}) => {
  const copy = whatWeHeardCopy(isServe)
  const headingId = useId()
  const queryClient = useQueryClient()
  const { data: proposed } = useQuery(proposedTagsQueryOptions)
  const tags = proposed?.filter((tag) => tag.proposedByRunId === runId)

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateIssueTag }) =>
      clientRequest('PATCH /v1/constituent-feedback/tags/:id', {
        id,
        ...body,
      }).then((res) => res.data),
    onSuccess: (_tag, { body }) => {
      if (body.action === 'accept') {
        trackEvent(EVENTS.IssueCapture.TagAccepted, {
          source: 'report',
          product: outreachProduct(isServe),
        })
      } else if (body.action === 'retire') {
        trackEvent(EVENTS.IssueCapture.TagDismissed, {
          product: outreachProduct(isServe),
        })
      }
      void queryClient.invalidateQueries({ queryKey: PROPOSED_TAGS_QUERY_KEY })
      // A theme carries its tag's status, which this just changed.
      void queryClient.invalidateQueries({
        queryKey: ['issue-capture', 'report'],
      })
    },
  })

  if (!tags || tags.length === 0) return null

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border p-4"
    >
      <h2 id={headingId} className="text-base font-semibold text-foreground">
        {copy.newTags}
      </h2>
      <p className="text-sm text-muted-foreground">{copy.newTagsCaption}</p>
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {tags.map((tag) => (
          <li
            key={tag.id}
            aria-label={tag.name}
            className="flex flex-wrap items-center justify-between gap-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
              <TagIcon size={16} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{tag.name}</span>
            </span>
            <span className="flex shrink-0 gap-2">
              <Button
                size="small"
                variant="ghost"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({ id: tag.id, body: { action: 'retire' } })
                }
              >
                {copy.dismiss}
              </Button>
              <Button
                size="small"
                variant="outline"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({ id: tag.id, body: { action: 'accept' } })
                }
              >
                {copy.accept}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {update.isError && (
        <p className="mt-2 text-sm text-destructive">{copy.tagFailed}</p>
      )}
    </section>
  )
}

export default NewTagsStrip
