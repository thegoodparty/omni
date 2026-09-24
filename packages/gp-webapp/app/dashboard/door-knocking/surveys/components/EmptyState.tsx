import { Card } from '@styleguide'
import CreateSurvey from './CreateSurvey'

interface EcanvasserTeam {
  id: number
  name: string
}

interface EmptyStateProps {
  teams?: EcanvasserTeam[]
  createCallback: () => void
}

export default function EmptyState({
  teams = [],
  createCallback,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="my-12 flex flex-col items-center gap-6">
      <Card className="w-full p-6 text-center text-sm text-muted-foreground">
        No door knocking scripts yet. Create one to start collecting answers at
        the door.
      </Card>
      <CreateSurvey teams={teams} createCallback={createCallback} />
    </div>
  )
}
