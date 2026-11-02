// No 'use client': every caller is already a client component.
import { Button, Card } from '@styleguide'
import { ExternalLinkIcon } from '@styleguide/components/ui/icons'
import { COMMUNITY_COPY, COMMUNITY_URL } from '../electionResultCopy'

export const CommunityCard = ({
  description,
}: {
  description: string
}): React.JSX.Element => (
  <Card className="gap-4 p-6">
    <div className="flex flex-col gap-1.5">
      <h2 className="text-lg font-semibold">{COMMUNITY_COPY.title}</h2>
      <p className="text-muted-foreground">{description}</p>
    </div>
    <Button asChild size="large" className="w-full">
      <a href={COMMUNITY_URL} target="_blank" rel="noopener noreferrer">
        {COMMUNITY_COPY.join}
        <ExternalLinkIcon aria-hidden />
      </a>
    </Button>
  </Card>
)
