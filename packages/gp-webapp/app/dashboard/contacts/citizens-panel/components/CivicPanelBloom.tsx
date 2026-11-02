import type { CivicPanelCompositionGroup } from '@goodparty_org/contracts'
import { cn } from '@styleguide/lib/utils'
import { SERVE_CITIZENS_PANEL_COPY as COPY } from '../citizensPanelCopy'
import {
  BLOOM_R0,
  BLOOM_RMAX,
  buildBloom,
  LABEL_ALL_UP_TO,
  labelAnchor,
  LIST_SIZE,
  polar,
  roundCoord,
  sectorPath,
  type Bloom,
  type Petal,
} from './panelCharts'

// The flower sits in a 320 square; with names around it the frame widens.
const FLOWER = 320
const LABELED = { width: 600, height: 440 }
const CX = LABELED.width / 2
const CY = LABELED.height / 2
const LABEL_R = BLOOM_RMAX + 14

const PETAL_FILL: Record<Petal['bucket'], string> = {
  over: 'fill-primary',
  under: 'fill-warning',
  even: 'fill-muted-foreground/50',
}

const petalText = (petal: Petal) =>
  petal.bucket === 'even' ? COPY.aboutShare : COPY.percentOfShare(petal.percent)

// With more groups than fit around the flower, only the furthest under are
// named.
const labeledPetals = (bloom: Bloom): Petal[] =>
  bloom.petals.length <= LABEL_ALL_UP_TO
    ? bloom.petals
    : bloom.petals
        .filter((petal) => petal.bucket === 'under')
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, LIST_SIZE)

type Summary = (atShare: number, total: number) => string

const Flower = ({
  bloom,
  labeled,
  summary,
  className,
}: {
  bloom: Bloom
  labeled: boolean
  summary: Summary
  className?: string
}) => {
  const viewBox = labeled
    ? `0 0 ${LABELED.width} ${LABELED.height}`
    : `${CX - FLOWER / 2} ${CY - FLOWER / 2} ${FLOWER} ${FLOWER}`
  const sector = (petal: Petal, r: number) =>
    sectorPath(CX, CY, BLOOM_R0, r, petal.a0, petal.a1)
  return (
    <svg
      viewBox={viewBox}
      className={cn('h-auto w-full', className)}
      role="img"
      aria-label={summary(bloom.atShare, bloom.petals.length)}
    >
      <path
        d={bloom.petals.map((petal) => sector(petal, BLOOM_RMAX)).join(' ')}
        className="fill-muted stroke-border"
      />
      {(['over', 'under', 'even'] as const).map((bucket) => (
        <path
          key={bucket}
          d={bloom.petals
            .filter((petal) => petal.bucket === bucket)
            .map((petal) => sector(petal, petal.radius))
            .join(' ')}
          className={PETAL_FILL[bucket]}
        />
      ))}
      <circle
        cx={CX}
        cy={CY}
        r={bloom.ringRadius}
        fill="none"
        strokeWidth={2}
        className="stroke-foreground"
      />
      <text
        x={CX}
        y={CY + 2}
        textAnchor="middle"
        className="fill-foreground text-lg font-semibold"
      >
        {COPY.bloomAtShare(bloom.atShare, bloom.petals.length)}
      </text>
      <text
        x={CX}
        y={CY + 18}
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
      >
        {COPY.bloomAtShareLabel}
      </text>
      {labeled
        ? labeledPetals(bloom).map((petal) => {
            const cos = Math.cos(petal.mid)
            const { x, y } = polar(CX, CY, LABEL_R, petal.mid)
            const short = petal.bucket === 'under'
            return (
              <text
                key={petal.group}
                x={x}
                y={roundCoord(y - 3)}
                textAnchor={labelAnchor(cos)}
                className="text-xs"
              >
                <tspan
                  x={x}
                  className={
                    short
                      ? 'fill-warning-dark font-semibold'
                      : 'fill-foreground font-medium'
                  }
                >
                  {COPY.groupLabel[petal.group]}
                </tspan>
                <tspan
                  x={x}
                  dy={16}
                  className={
                    short ? 'fill-warning-dark' : 'fill-muted-foreground'
                  }
                >
                  {petalText(petal)}
                </tspan>
              </text>
            )
          })
        : null}
    </svg>
  )
}

const Swatch = ({ className }: { className: string }) => (
  <span aria-hidden className={cn('size-2.5 rounded-sm', className)} />
)

// Each group as a petal sized by its share of the members against its share
// of the district. Who to invite next is the API's call (the balance's
// `inviteMore`, what the next draw leans toward), never the petals', so
// `showNext` only says every group has its share, and is off when the
// status above names someone. A priority's results draw the same petals
// from who answered, with their own `summary`.
export const CivicPanelBloom = ({
  groups,
  showNext,
  summary = COPY.bloomSummary,
}: {
  groups: CivicPanelCompositionGroup[]
  showNext: boolean
  summary?: Summary
}) => {
  const bloom = buildBloom(groups)
  return (
    <div className="flex flex-col gap-3" data-testid="civic-panel-bloom">
      <p className="text-sm text-muted-foreground">{COPY.bloomCaption}</p>
      <div className="mx-auto w-full max-w-[20rem] sm:max-w-[37.5rem]">
        <Flower
          bloom={bloom}
          labeled
          summary={summary}
          className="hidden sm:block"
        />
        <Flower
          bloom={bloom}
          labeled={false}
          summary={summary}
          className="sm:hidden"
        />
      </div>
      {/* Names around the flower do not fit on a phone, so they list here. */}
      <ul className="flex flex-col gap-1 sm:hidden">
        {labeledPetals(bloom).map((petal) => {
          const short = petal.bucket === 'under'
          return (
            <li
              key={petal.group}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span
                className={
                  short ? 'font-semibold text-warning-dark' : 'text-foreground'
                }
              >
                {COPY.groupLabel[petal.group]}
              </span>
              <span
                className={
                  short ? 'text-warning-dark' : 'text-muted-foreground'
                }
              >
                {petalText(petal)}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Swatch className="bg-primary" />
          {COPY.legendOver}
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch className="bg-warning" />
          {COPY.legendUnder}
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch className="bg-muted-foreground/50" />
          {COPY.legendEven}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-t-2 border-foreground" />
          {COPY.legendRing}
        </span>
      </div>
      {showNext && bloom.furthestUnder === null ? (
        <p className="border-t border-border pt-3 text-sm text-foreground">
          {COPY.everyGroupShare}
        </p>
      ) : null}
    </div>
  )
}
