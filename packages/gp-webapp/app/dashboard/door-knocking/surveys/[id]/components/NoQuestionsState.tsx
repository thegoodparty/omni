'use client'
import { Card } from '@styleguide'
import CreateQuestion from './CreateQuestion'

export default function NoQuestionsState(): React.JSX.Element {
  return (
    <div className="my-12 flex flex-col items-center gap-6">
      <Card className="w-full p-6 text-center text-sm text-muted-foreground">
        No questions yet. Add one to build out this script.
      </Card>
      <CreateQuestion />
    </div>
  )
}
