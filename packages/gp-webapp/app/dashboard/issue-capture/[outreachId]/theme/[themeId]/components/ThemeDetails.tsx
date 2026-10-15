import { useId, useState } from 'react'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import {
  Badge,
  Button,
  Card,
  CardContent,
  ClipboardListIcon,
  MessageSquareIcon,
} from '@styleguide'
import { whatWeHeardCopy } from '../../../../copy'

const VISIBLE_WANTS = 5

// Each distinct ask, the most named first by how many issues in the theme's
// notes named it. The API sends the asks deduplicated, so the counts come
// from the members it sends with them; spellings that differ only in case are
// one ask, shown as first written.
const rankWants = (theme: FeedbackThemeDetail) => {
  const mentions = new Map<string, number>()
  theme.members
    .flatMap((member) => member.issues)
    .forEach((issue) => {
      const key = issue.desiredOutcome?.trim().toLowerCase()
      if (key) mentions.set(key, (mentions.get(key) ?? 0) + 1)
    })
  const wants = new Map<string, { outcome: string; count: number }>()
  theme.desiredOutcomes.forEach((outcome) => {
    const key = outcome.trim().toLowerCase()
    if (!wants.has(key)) {
      wants.set(key, { outcome, count: Math.max(mentions.get(key) ?? 0, 1) })
    }
  })
  return [...wants.values()].sort((a, b) => b.count - a.count)
}

// What the run wrote about the theme, then what the people in it asked for,
// in that order; where they stand is on the summary above. The asks are left
// out entirely when nobody named one, rather than a heading over nothing.
const ThemeDetails = ({
  theme,
  isServe,
}: {
  theme: FeedbackThemeDetail
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const wantsId = useId()
  const [expanded, setExpanded] = useState(false)
  const wants = rankWants(theme)
  const shown = expanded ? wants : wants.slice(0, VISIBLE_WANTS)
  const hidden = wants.length - shown.length

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ClipboardListIcon size={18} aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">
              {copy.details}
            </h2>
          </div>
          <p className="text-sm text-foreground">{theme.details}</p>
        </CardContent>
      </Card>
      {wants.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <MessageSquareIcon size={18} aria-hidden="true" />
              <h2
                id={wantsId}
                className="text-base font-semibold text-foreground"
              >
                {copy.whatPeopleWant}
              </h2>
            </div>
            {/* The raw asks as outline badges in a row, the most named first
                and no count on them: an exact-match count splits one ask
                written two ways. `max-w-full` and `whitespace-normal` let a
                long ask wrap inside its badge, which the styleguide's badge
                keeps to one line. `flex` on the li because globals.css makes
                every li under a data-slot a flex row. */}
            <ul aria-labelledby={wantsId} className="flex flex-wrap gap-2">
              {shown.map(({ outcome }) => (
                <li key={outcome} className="flex max-w-full">
                  <Badge
                    variant="outline"
                    className="max-w-full whitespace-normal text-left"
                  >
                    {outcome}
                  </Badge>
                </li>
              ))}
            </ul>
            {hidden > 0 && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="small"
                  onClick={() => setExpanded(true)}
                >
                  {copy.showMoreWants(hidden)}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}

export default ThemeDetails
