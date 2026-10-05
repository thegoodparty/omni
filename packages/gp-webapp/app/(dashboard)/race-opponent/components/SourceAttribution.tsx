import { ExternalLinkIcon } from '@styleguide/components/ui/icons'

type Props = {
  sourceUrl: string
  sourceType: string
  label: string
}

const SourceAttribution = ({
  sourceUrl,
  sourceType,
  label,
}: Props): React.JSX.Element => (
  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
    <span className="font-medium">{sourceType}:</span>
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      <span className="break-all">{label}</span>
      <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
    </a>
  </p>
)

export default SourceAttribution
