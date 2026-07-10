import type { TalkingPoint } from '@shared/briefings/types'

type Props = {
  points: TalkingPoint[]
  pathPrefix: string
}

/**
 * Bulleted list of talking points. Each point gets its own json-path
 * anchor so phase 4 can resolve selections inside a single point.
 *
 * `points` entries are either a legacy bare string (old artifacts) or a
 * `{text, why}` object (all new generations) — the bullet renders `text`
 * as today, with `why` as a secondary muted line underneath giving the
 * strategic rationale for the ask.
 */
export default function TalkingPointsList({
  points,
  pathPrefix,
}: Props): React.JSX.Element | null {
  if (points.length === 0) return null
  return (
    <ul className="list-disc! space-y-2 pl-5 text-sm leading-6 text-foreground">
      {points.map((p, i) => {
        const isStructured = typeof p !== 'string'
        return (
          <li
            key={`${pathPrefix}/${i}`}
            className="list-item!"
            data-anchor-json-path={`${pathPrefix}/${i}`}
          >
            {isStructured ? (
              <>
                <span data-anchor-json-path={`${pathPrefix}/${i}/text`}>
                  {p.text}
                </span>
                <p
                  className="mt-0.5 text-xs leading-5 text-muted-foreground"
                  data-anchor-json-path={`${pathPrefix}/${i}/why`}
                >
                  {p.why}
                </p>
              </>
            ) : (
              p
            )}
          </li>
        )
      })}
    </ul>
  )
}
