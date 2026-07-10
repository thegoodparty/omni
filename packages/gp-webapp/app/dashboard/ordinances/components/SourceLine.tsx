import { SourceCitation } from '@styleguide'
import type { OrdinanceSource } from '@goodparty_org/contracts'

// "source:" label + the styleguide source chip, in the muted treatment the
// ordinance widgets share (same look as ClarifyQuestionWidget's OptionSource).
export default function SourceLine({
  source,
}: {
  source: OrdinanceSource
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="italic">source:</span>
      <SourceCitation
        organization={source.publisher ?? 'Source'}
        title={source.title}
        description={source.excerpt ?? source.title}
        chipLabel={source.title}
        className="hover:bg-muted"
        {...(source.url ? { url: source.url } : {})}
      />
    </div>
  )
}
