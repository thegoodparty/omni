import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { GoodPartyOrgLogo } from '@styleguide'
import type { FirstMeeting } from './firstMeeting'
import { countWords, Rise, Words } from './Reveal'
import { useDock } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

const DROP_EVERY_S = 1.3
const NAME_BASE_PX = 22
const NAME_MIN_PX = 14
const NAME_MAX_SCALE = 1.4

const Lines = ({ count }: { count: number }): React.JSX.Element => (
  <>
    {Array.from({ length: count }, (_, index) => (
      <i key={index} />
    ))}
  </>
)

// Documents dropping into a folder with the official's name on it. A
// picture of what a briefing gathers, not a list of what is in theirs.
const BriefingFolder = ({
  name,
  meeting,
}: {
  name: string | null
  meeting: FirstMeeting
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.briefing
  const nameRef = useRef<HTMLElement>(null)
  const [minutes, fiscalNote] = copy.restingDocs
  const cycle = copy.droppingDocs.length * DROP_EVERY_S

  // The name fills about nine tenths of its box: a short one grows, a long
  // one shrinks.
  useLayoutEffect(() => {
    const el = nameRef.current
    const box = el?.parentElement
    if (!el || !box) return
    el.style.fontSize = `${NAME_BASE_PX}px`
    const width = el.scrollWidth
    const room = (box.clientWidth - 14) * 0.9
    if (!width || !room) return
    const size = Math.max(
      NAME_MIN_PX,
      Math.min(NAME_BASE_PX * NAME_MAX_SCALE, (NAME_BASE_PX * room) / width),
    )
    el.style.fontSize = `${size.toFixed(1)}px`
  }, [name])

  return (
    <div className="ww-folder" role="img" aria-label={copy.folderAlt(name)}>
      <div className="ww-folder-back" />
      <div className="ww-doc ww-doc-rest-3">
        {minutes}
        <Lines count={4} />
      </div>
      <div className="ww-doc ww-doc-rest-2">
        {fiscalNote}
        <Lines count={4} />
      </div>
      <div className="ww-doc ww-doc-rest-1">
        {copy.agenda(meeting)}
        <Lines count={4} />
      </div>
      {copy.droppingDocs.map((doc, index) => (
        <div
          key={doc}
          className="ww-doc ww-doc-drop"
          style={
            {
              '--cycle': `${cycle}s`,
              '--d': `${index * DROP_EVERY_S}s`,
              '--r': `${(index % 2 ? 1 : -1) * (3 + (index % 3) * 2)}deg`,
            } as CSSProperties
          }
        >
          {doc}
          <Lines count={5} />
        </div>
      ))}
      <div className="ww-folder-front">
        <div className="ww-sticker">
          <GoodPartyOrgLogo size="small" className="flex-none" />
          {name && (
            <div className="ww-sticker-name">
              <b ref={nameRef}>{name}</b>
            </div>
          )}
        </div>
        <span className="ww-folder-label">{copy.folderLabel}</span>
      </div>
    </div>
  )
}

// Step 3: the Meeting Briefing, and the day it will be ready.
export const BriefingStep = ({
  meeting,
  readyDay,
  name,
  place,
  onNext,
}: {
  meeting: FirstMeeting
  readyDay: Date
  name: string | null
  place: string | null
  onNext: () => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.briefing
  const title = copy.title(readyDay)
  const titleWords = countWords(title.lead ?? '') + 1

  useDock('briefing', 2300, [
    { key: 'next', label: copy.next, kind: 'primary', onClick: onNext },
  ])

  return (
    <div className="flex w-full max-w-[720px] flex-col items-center gap-5 text-center">
      <Rise delay={200}>
        <BriefingFolder name={name} meeting={meeting} />
      </Rise>
      <h1 className="ww-title">
        <Words delay={600}>
          {`${title.lead} `}
          <span className="text-primary">{title.accent}</span>
        </Words>
      </h1>
      <p className="ww-lede max-w-[52ch] text-muted-foreground">
        <Words delay={1500} index={titleWords}>
          {copy.lede(place)}
        </Words>
      </p>
    </div>
  )
}
