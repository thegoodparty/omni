import { StatusText } from '@styleguide'
import { Loader2Icon } from '@styleguide/components/ui/icons'
import { DetailsSection } from '../listDetails/ListDetailsMetric'
import { OutreachResultsCard } from '../listDetails/OutreachResultsCard'
import { OUTREACH_RESULTS_COPY } from '../outreachResultsCopy'
import { useEmailSend } from './emailApi'
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
        <DetailsSection title={OUTREACH_RESULTS_COPY.title}>
          <OutreachResultsCard
            testId="email-drawer-statistics"
            basedOn={OUTREACH_RESULTS_COPY.basedOn(
              counts.sent,
              'email sent',
              'emails sent',
            )}
            total={counts.sent}
            rows={EMAIL_RESULT_ROWS.map((row) => ({
              label: row.label,
              count: row.count(counts),
              percentSuffix: row.percentSuffix,
            }))}
          />
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
