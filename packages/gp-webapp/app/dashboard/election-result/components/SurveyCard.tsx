// No 'use client': every caller is already a client component.
import { Button, Card } from '@styleguide'
import { ExternalLinkIcon } from '@styleguide/components/ui/icons'
import { SURVEY_BUTTON } from '../electionResultCopy'

export const SurveyCard = ({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}): React.JSX.Element => (
  <Card className="gap-4 p-6">
    <div className="flex flex-col gap-1.5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground">{description}</p>
    </div>
    <Button asChild size="large" className="w-full">
      <a href={url} target="_blank" rel="noopener noreferrer">
        {SURVEY_BUTTON}
        <ExternalLinkIcon aria-hidden />
      </a>
    </Button>
  </Card>
)
