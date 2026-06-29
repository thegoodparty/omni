'use client'

import { useState } from 'react'
import type { ContrastRecord } from 'gpApi/api-endpoints'
import ContrastCard, { isRenderableContrast } from './ContrastCard'

type Props = {
  initialContrasts: ContrastRecord[]
}

// Contrasts are a Phase-1 surface. Per the "hidden, not placeholdered" product
// decision, this renders nothing until real contrasts exist — no "coming soon"
// copy and no empty-state shell.
const ContrastList = ({
  initialContrasts,
}: Props): React.JSX.Element | null => {
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
    return null
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
