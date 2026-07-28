import { fetchContentByType } from 'helpers/fetchHelper'
import pageMetaData from 'helpers/metadataHelper'
import { camelToSentence } from 'helpers/stringHelper'
import candidateAccess from '../shared/candidateAccess'
import ContentPage from './components/ContentPage'
import { fetchUserCampaign } from 'app/onboarding/shared/getCampaign'
import { getServerUser } from 'helpers/userServerHelper'
import { serverLoadCandidatePosition } from 'app/dashboard/campaign-details/components/issues/serverIssuesUtils'
export const dynamic = 'force-dynamic'

const meta = pageMetaData({
  title: 'Campaign Content | GoodParty.org',
  description: 'Campaign Content',
  slug: '/dashboard/content',
})
export const metadata = meta

interface Category {
  name: string
  templates: { key: string; name: string }[]
}

export default async function Page(): Promise<React.JSX.Element> {
  await candidateAccess()
  const campaign = await fetchUserCampaign()

  // These fetches are independent of one another (serverLoadCandidatePosition
  // only depends on the already-resolved campaign), so run them concurrently to
  // avoid a request waterfall.
  const [promptsRaw, requiresQuestions, categories, candidatePositions, user] =
    await Promise.all([
      fetchContentByType<object>('candidateContentPrompts'),
      fetchContentByType<Partial<Record<string, boolean>>>(
        'contentPromptsQuestions',
      ),
      fetchContentByType<Category[]>('aiContentCategories'),
      campaign
        ? serverLoadCandidatePosition(campaign.id)
        : Promise.resolve(false as const),
      getServerUser(), // can be removed when door knocking app is not for admins only
    ])

  const prompts = parsePrompts(promptsRaw)

  const childProps = {
    pathname: '/dashboard/content',
    campaign,
    prompts,
    templates: promptsRaw,
    categories,
    requiresQuestions,
    candidatePositions,
    user,
  }

  return <ContentPage {...childProps} />
}

interface Prompt {
  key: string
  title: string
}

const parsePrompts = (promptsRaw: object): Prompt[] => {
  const keys = Object.keys(promptsRaw)
  const prompts: Prompt[] = []
  keys.forEach((key) => {
    prompts.push({
      key,
      title: camelToSentence(key),
    })
  })
  return prompts
}
