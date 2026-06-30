type Props = {
  title: string
  raceContext?: string
  actions?: React.ReactNode
}

const OpponentPageHeader = ({
  title,
  raceContext,
  actions,
}: Props): React.JSX.Element => (
  <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      {raceContext && (
        <p className="text-sm text-muted-foreground">{raceContext}</p>
      )}
    </div>
    {actions && <div className="shrink-0">{actions}</div>}
  </header>
)

export default OpponentPageHeader
