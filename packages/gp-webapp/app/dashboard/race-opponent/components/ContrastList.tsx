'use client'

import { useState } from 'react'
import type { ContrastRecord } from 'gpApi/api-endpoints'
import ContrastCard, { isRenderableContrast } from './ContrastCard'

type Props = {
  initialContrasts: ContrastRecord[]
}

const ContrastList = ({ initialContrasts }: Props): React.JSX.Element => {
  // Sourced-or-silent: drop any contrast missing a content field (especially
  // sourceUrl) before it ever renders. The server already hides
  // pending_review/blocked, so the list only carries cleared/approved/used.
  const [contrasts, setContrasts] = useState<ContrastRecord[]>(() =>
    initialContrasts.filter(isRenderableContrast),
  )

  const handleChange = (updated: ContrastRecord): void => {
    setContrasts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  if (contrasts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No contrasts to review yet. Once your opponent research turns up sourced
        facts, drafted contrasts will appear here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {contrasts.map((contrast) => (
        <ContrastCard
          key={contrast.id}
          contrast={contrast}
          onChange={handleChange}
        />
      ))}
    </div>
  )
}

export default ContrastList
