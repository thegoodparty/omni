import { StatusText } from '@styleguide'
import { ChartColumnIcon, Loader2Icon } from '@styleguide/components/ui/icons'
import { DetailsSection } from '../listDetails/ListDetailsMetric'
import { useEmailSend } from './emailApi'
import { formatCount } from './emailFlow.util'
import { EmailPreview } from './EmailPreview'
import { EMAIL_RESULT_ROWS } from './EmailStatus'

interface EmailDrawerSectionsProps {
  id: number
  isServe: boolean
}

// The history drawer's body for an email: its delivery numbers laid out like
// a text send's Statistics card, then the email itself, the way a social
// campaign shows its posts.
export const EmailDrawerSections = ({
  id,
  isServe,
}: EmailDrawerSectionsProps) => {
  const { data: send, isLoading, isError } = useEmailSend(isServe, id)

  if (isLoading) {
    return (
      <StatusText
        tone="muted"
        icon={<Loader2Icon />}
        spinning
        className="text-sm"
      >
        Loading your email…
      </StatusText>
    )
  }
  if (isError || !send) {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this email. Close and try again.
      </p>
    )
  }

  const counts = send.deliveryCounts
  return (
    <>
      {counts && counts.sent > 0 && (
        <DetailsSection title="Statistics">
          <div
            className="overflow-hidden rounded-lg border border-border"
            data-testid="email-drawer-statistics"
          >
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <ChartColumnIcon className="size-4" />
              Based on {formatCount(counts.sent)} email
              {counts.sent === 1 ? '' : 's'} sent
            </div>
            {EMAIL_RESULT_ROWS.map((row) => {
              const count = row.count(counts)
              return (
                <div
                  key={row.label}
                  className="flex items-center justify-between border-t border-border px-3 py-2"
                >
                  <span className="text-sm">{row.label}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">
                      {formatCount(count)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {Math.round((count / counts.sent) * 100)}%
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </DetailsSection>
      )}
      <DetailsSection title="Email">
        <EmailPreview
          serve={isServe}
          content={send.content}
          subject={send.content.subject}
        />
      </DetailsSection>
    </>
  )
}
