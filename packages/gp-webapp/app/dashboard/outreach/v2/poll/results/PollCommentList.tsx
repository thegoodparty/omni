import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type {
  SmsOutreachReply,
  SmsOutreachRepliesFilter,
} from '@goodparty_org/contracts'
import {
  Button,
  ChevronDownIcon,
  HeartIcon,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@styleguide'
import { PollCrmPanel } from './PollCrmPanel'
import { SERVE_POLL_READER_COPY } from './pollResultsCopy'
import {
  pollRepliesQueryOptions,
  useReplyFlagMutation,
  type ReplyScope,
} from './queries'

const FILTERS: SmsOutreachRepliesFilter[] = ['all', 'unread', 'favorited']

const displayName = (reply: SmsOutreachReply): string =>
  reply.firstName?.trim() || SERVE_POLL_READER_COPY.anonymous

// A response drops out of Unread once it has been opened and closed again, and
// out of Favorited the moment the heart is cleared. The open one stays put so
// its panel does not vanish under the reader.
const isListed = (
  reply: SmsOutreachReply,
  filter: SmsOutreachRepliesFilter,
  openId: string | null,
): boolean => {
  if (filter === 'unread') return !reply.read || reply.id === openId
  if (filter === 'favorited') return reply.favorited === true
  return true
}

const ReplyRow = ({
  reply,
  open,
  onToggleOpen,
  onToggleFavorite,
}: {
  reply: SmsOutreachReply
  open: boolean
  onToggleOpen: () => void
  onToggleFavorite: () => void
}) => {
  const name = displayName(reply)
  const favorited = reply.favorited === true
  return (
    // `block`: globals.css turns every <li> under a [data-slot] ancestor into
    // a flex row, which would put the name and message side by side.
    <li className="block border-t border-border px-3 py-3 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {reply.read === false && (
            <span
              role="img"
              aria-label={SERVE_POLL_READER_COPY.unread}
              className="size-2 rounded-full bg-primary"
            />
          )}
          {name}
          {reply.isOptOut && (
            <span className="text-xs font-normal text-muted-foreground">
              {SERVE_POLL_READER_COPY.optedOut}
            </span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="small"
          aria-pressed={favorited}
          aria-label={
            favorited
              ? SERVE_POLL_READER_COPY.unfavorite(name)
              : SERVE_POLL_READER_COPY.favorite(name)
          }
          onClick={onToggleFavorite}
        >
          <HeartIcon className={cn('size-4', favorited && 'fill-current')} />
        </Button>
      </div>
      <p className="mt-1 text-sm whitespace-pre-line text-foreground">
        {reply.content}
      </p>
      <Button
        type="button"
        variant="link"
        aria-expanded={open}
        className="h-auto px-0 text-xs no-underline has-[>svg]:px-0"
        onClick={onToggleOpen}
      >
        <ChevronDownIcon className={cn('size-3', open && 'rotate-180')} />
        {open
          ? SERVE_POLL_READER_COPY.hideDetails
          : SERVE_POLL_READER_COPY.showDetails}
      </Button>
      {open && <PollCrmPanel crm={reply.crm} receivedAt={reply.receivedAt} />}
    </li>
  )
}

// The replies reader: filter tabs, a heart on every response, and a read mark
// written only when a response is opened.
export const PollCommentList = ({
  outreachId,
  scope,
}: {
  outreachId: number
  scope: ReplyScope
}) => {
  const [filter, setFilter] = useState<SmsOutreachRepliesFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const query = useInfiniteQuery(
    pollRepliesQueryOptions(outreachId, scope, filter),
  )
  const flags = useReplyFlagMutation(outreachId)

  const pages = query.data?.pages ?? []
  const replies = pages
    .flatMap((page) => page.replies)
    .filter((reply) => isListed(reply, filter, openId))
  const total = pages.length > 0 ? pages[pages.length - 1]!.total : 0

  const toggleOpen = (reply: SmsOutreachReply) => {
    if (openId === reply.id) {
      setOpenId(null)
      return
    }
    setOpenId(reply.id)
    if (reply.read === false) {
      flags.mutate({ replyId: reply.id, update: { read: true } })
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">
        {SERVE_POLL_READER_COPY.responsesTitle}
      </h2>
      <Tabs
        value={filter}
        onValueChange={(value) => {
          setFilter(value as SmsOutreachRepliesFilter)
          setOpenId(null)
        }}
      >
        <TabsList aria-label={SERVE_POLL_READER_COPY.tabsLabel}>
          {FILTERS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {SERVE_POLL_READER_COPY.tabs[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
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
      ) : replies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {SERVE_POLL_READER_COPY.empty[filter]}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ul>
            {replies.map((reply) => (
              <ReplyRow
                key={reply.id}
                reply={reply}
                open={openId === reply.id}
                onToggleOpen={() => toggleOpen(reply)}
                onToggleFavorite={() =>
                  flags.mutate({
                    replyId: reply.id,
                    update: { favorited: reply.favorited !== true },
                  })
                }
              />
            ))}
          </ul>
        </div>
      )}
      {query.hasNextPage && (
        <>
          <p className="text-xs text-muted-foreground">
            {SERVE_POLL_READER_COPY.showingOf(
              pages.reduce((count, page) => count + page.replies.length, 0),
              total,
            )}
          </p>
          <Button
            type="button"
            variant="link"
            disabled={query.isFetchingNextPage}
            className="h-auto w-fit px-0 no-underline has-[>svg]:px-0"
            onClick={() => {
              void query.fetchNextPage()
            }}
          >
            {query.isFetchingNextPage
              ? SERVE_POLL_READER_COPY.loadingMore
              : SERVE_POLL_READER_COPY.loadMore}
          </Button>
        </>
      )}
    </section>
  )
}
