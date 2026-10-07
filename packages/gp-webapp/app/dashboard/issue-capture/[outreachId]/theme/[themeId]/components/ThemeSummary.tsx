import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { Card, CardContent } from '@styleguide'
import { whatWeHeardCopy } from '../../../../copy'

// How many conversations the theme came from and what the run wrote about
// it. The title is the page's title bar, so it is not repeated here.
const ThemeSummary = ({
  theme,
  isServe,
}: {
  theme: FeedbackThemeDetail
  isServe: boolean
}) => (
  <Card>
    <CardContent className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {whatWeHeardCopy(isServe).conversations(theme.conversationCount)}
      </p>
      <p className="text-base text-foreground">{theme.summary}</p>
    </CardContent>
  </Card>
)

export default ThemeSummary
