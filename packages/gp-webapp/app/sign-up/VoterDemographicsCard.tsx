import { Check, LineChart } from 'lucide-react'

const ROWS = [
  { label: 'Age', value: '18 - 40' },
  { label: 'Voting History', value: 'Likely Voters (50%-75%)' },
  { label: 'Political Party', value: 'Independent / Non-Partisan' },
  { label: 'Income', value: '$25k - $50k' },
]

const CheckedBox = () => (
  <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-[#006bce]">
    <Check className="size-3 text-white" strokeWidth={3} />
  </span>
)

export default function VoterDemographicsCard() {
  return (
    <div
      className="w-full max-w-[280px] rounded-[14px] bg-white p-5 shadow-lg"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-outfit text-lg font-semibold text-[#0a0a0a]">
          Voter Demographics
        </h3>
        <LineChart className="size-[18px] text-[#0a0a0a]" />
      </div>
      <div className="mt-4 divide-y divide-neutral-200">
        {ROWS.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
          >
            <span className="font-outfit text-sm font-medium text-black">
              {row.label}
            </span>
            <div className="flex items-center gap-2">
              <CheckedBox />
              <span className="text-xs text-[#232c3d]">{row.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
