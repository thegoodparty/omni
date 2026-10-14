import { useId } from 'react'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import {
  Card,
  CardContent,
  ClipboardListIcon,
  MessageSquareIcon,
} from '@styleguide'
import { whatWeHeardCopy } from '../../../../copy'

// What the run wrote about the theme and every distinct outcome the people in
// it asked for, in that order; where they stand is on the summary above. The asks are left out
// entirely when nobody named one, rather than a heading over nothing.
const ThemeDetails = ({
  theme,
  isServe,
}: {
  theme: FeedbackThemeDetail
  isServe: boolean
}) => {
  const copy = whatWeHeardCopy(isServe)
  const wantsId = useId()

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
          <p className="text-base text-foreground">{theme.details}</p>
        </CardContent>
      </Card>
      {theme.desiredOutcomes.length > 0 && (
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
            <ul
              aria-labelledby={wantsId}
              className="flex list-disc flex-col gap-1 pl-5 text-base text-foreground"
            >
              {/* `list-item`: globals.css makes every li under a data-slot
                  a flex row, which takes its bullet away. */}
              {theme.desiredOutcomes.map((outcome) => (
                <li key={outcome} className="list-item">
                  {outcome}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}

export default ThemeDetails
