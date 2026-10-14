import { Button } from '@styleguide'

// A flow a chat card opened already knows who gets it, so it says so in one
// line above the message instead of opening on the list builder.
export const ProposalAudienceSummary = ({
  summary,
  onChange,
}: {
  summary: string
  onChange: () => void
}): React.JSX.Element => (
  <div
    className="flex flex-col items-start gap-1 rounded-xl border border-border bg-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    data-testid="proposal-audience-summary"
  >
    <p className="text-sm text-foreground">{summary}</p>
    <Button
      type="button"
      variant="link"
      size="small"
      className="shrink-0 px-0"
      onClick={onChange}
    >
      Change who gets this
    </Button>
  </div>
)
