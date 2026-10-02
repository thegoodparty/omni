import { useId } from 'react'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import {
  Card,
  CardContent,
  ClipboardListIcon,
  MessageSquareIcon,
} from '@styleguide'
import { whatWeHeardCopy } from '../../../../copy'

// What the run wrote about the theme, and every distinct outcome the people
// in it asked for. Left out entirely when nobody named one, rather than a
// heading over nothing.
export default function ThemeDetails({
  theme,
  isServe,
}: {
  theme: FeedbackThemeDetail
  isServe: boolean
}) {
  const copy = whatWeHeardCopy(isServe)
  const wantsId = useId()

  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ClipboardListIcon size={18} aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">
              {copy.details}
            </h2>
          </div>
          <p className="text-sm text-foreground">{theme.details}</p>
        </div>
        {theme.desiredOutcomes.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <MessageSquareIcon size={18} aria-hidden="true" />
              <h2
                id={wantsId}
                className="text-base font-semibold text-foreground"
              >
                {copy.whatPeopleWant}
              </h2>
            </div>
            <ul
              aria-labelledby={wantsId}
              className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground"
            >
              {theme.desiredOutcomes.map((outcome) => (
                <li key={outcome}>{outcome}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
