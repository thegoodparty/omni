import { useId } from 'react'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import {
  Card,
  CardContent,
  ClipboardListIcon,
  MessageSquareIcon,
} from '@styleguide'
import { whatWeHeardCopy } from '../../../../copy'
import StanceSplit from '../../../components/StanceSplit'

// What the run wrote about the theme, where the people in it stand, and every
// distinct outcome they asked for, in that order. The asks are left out
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
          <p className="text-sm text-foreground">{theme.details}</p>
        </CardContent>
      </Card>
      <StanceSplit counts={theme.stanceCounts} isServe={isServe} />
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
              className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground"
            >
              {theme.desiredOutcomes.map((outcome) => (
                <li key={outcome}>{outcome}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}

export default ThemeDetails
