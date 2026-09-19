import { Button, Card, SparklesIcon, UserCheckIcon } from '@styleguide'
import type { RecommendedList } from '@goodparty_org/contracts'
import { useOpenChannelPicker } from '../shared/channelPicker/ChannelPickerProvider'
import { trackRecommendedSendOutreach } from './recommendedListOutreach.util'

interface RecommendedVoterListCardProps {
  recommendation: RecommendedList
  onDetails: () => void
}

// One recommended-list row in the voter data page's 560px column, the same
// row anatomy as the saved-list card beside it (ListCard.tsx) with the
// prototype's sparkle eyebrow above the name.
export default function RecommendedVoterListCard({
  recommendation,
  onDetails,
}: RecommendedVoterListCardProps) {
  const { copy, count } = recommendation
  const openChannelPicker = useOpenChannelPicker()

  return (
    <Card
      className="w-full gap-2 rounded-2xl p-4 shadow-xs"
      data-testid="recommended-voter-list-card"
    >
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
        <SparklesIcon className="size-3.5" aria-hidden />
        Recommended
      </p>
      <h3 className="text-base font-semibold">{copy.title}</h3>
      <p className="text-[13px] text-muted-foreground">
        {copy.criteriaSummary}
      </p>

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <UserCheckIcon className="size-3.5" aria-hidden />
          {count.toLocaleString()}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="small"
            className="h-8 px-3 text-xs text-primary hover:bg-primary/5"
            onClick={onDetails}
          >
            Details
          </Button>
          <Button
            size="small"
            className="h-8 px-3.5 text-xs"
            onClick={() => {
              trackRecommendedSendOutreach(recommendation, 'recommendedCard')
              openChannelPicker({ kind: 'recommended', recommendation })
            }}
          >
            Send outreach
          </Button>
        </div>
      </div>
    </Card>
  )
}
