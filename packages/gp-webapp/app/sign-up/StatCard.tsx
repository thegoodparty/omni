const DONUT_RADIUS = 66
const DONUT_PROGRESS = 0.58
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

const DonutChart = () => (
  <div className="relative size-40" aria-hidden="true">
    <svg viewBox="0 0 160 160" className="size-full">
      <circle
        cx={80}
        cy={80}
        r={DONUT_RADIUS}
        fill="none"
        stroke="#bfdbfe"
        strokeWidth={14}
      />
      <circle
        cx={80}
        cy={80}
        r={DONUT_RADIUS}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray={DONUT_CIRCUMFERENCE}
        strokeDashoffset={DONUT_CIRCUMFERENCE * (1 - DONUT_PROGRESS)}
        style={{
          transform: 'rotate(-90deg) scaleX(-1)',
          transformOrigin: 'center',
        }}
      />
    </svg>
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 font-outfit">
      <span className="text-[32px] leading-none font-semibold text-[#0a0a0a]">
        1,544
      </span>
      <span className="text-center text-xs leading-[14px] font-semibold text-[#0a0a0a]">
        Votes Needed
        <br />
        to Win
      </span>
    </div>
  </div>
)

export default function StatCard() {
  return (
    <div
      className="w-[280px] max-w-full rounded-[14px] bg-white p-3 shadow-lg"
      aria-hidden="true"
    >
      <div className="flex h-10 items-center rounded-md border border-[#a3a3a3]/50 bg-slate-50 px-3">
        <span className="font-outfit text-xs font-semibold text-[#0a0a0a]">
          Likely voters: 1,053
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-center rounded-md border border-[#a3a3a3]/50 bg-slate-50 py-3">
        <DonutChart />
      </div>
    </div>
  )
}
