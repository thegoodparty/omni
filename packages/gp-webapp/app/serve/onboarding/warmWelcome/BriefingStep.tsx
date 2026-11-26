import { useEffect, useRef, useState } from 'react'
import { CheckIcon } from '@styleguide/components/ui/icons'
import { useConfetti } from './ConfettiLayer'
import type { FirstMeeting } from './firstMeeting'
import { accentParts, accentWords } from './MeetingStep'
import { FoilLogo, vars } from './parts'
import { useEntranceOffset, useRise, Words } from './Reveal'
import { useDock } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

// One document drops every 1.3 seconds, on one long loop they all share.
const DROP_EVERY_S = 1.3
// After "You got it", a beat before moving on.
const REMINDED_HOLD_MS = 1450
const NAME_BASE_PX = 28

// The folder: a stack of documents with a new one dropping in, forever, and
// a name tag stuck on the front with the official's name handwritten on it.
// The name scales to fill about nine tenths of its box, so a short name gets
// big and a long one shrinks.
const Folder = ({
  meeting,
  name,
}: {
  meeting: FirstMeeting
  name: string | null
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.briefing
  const rise = useRise(200)
  const nameRef = useRef<HTMLElement>(null)
  const drops = copy.droppingDocs
  const cycle = drops.length * DROP_EVERY_S

  useEffect(() => {
    const fit = (): void => {
      const element = nameRef.current
      const box = element?.parentElement
      if (!element || !box) return
      element.style.fontSize = `${NAME_BASE_PX}px`
      const width = element.scrollWidth
      const room = (box.clientWidth - 14) * 0.9
      if (!width || !room) return
      const size = Math.max(
        14,
        Math.min(NAME_BASE_PX * 1.4, (NAME_BASE_PX * room) / width),
      )
      element.style.fontSize = `${size.toFixed(1)}px`
    }
    fit()
    void document.fonts?.ready.then(fit)
  }, [name])

  return (
    <div
      className="briefing ui"
      style={rise}
      role="img"
      aria-label={copy.folderAlt(name)}
    >
      <div className="fback" />
      <Doc className="rest3" lines={4}>
        {copy.restingDocs[0]}
      </Doc>
      <Doc className="rest2" lines={4}>
        {copy.restingDocs[1]}
      </Doc>
      <Doc className="rest1" lines={4}>
        {copy.agenda(meeting)}
      </Doc>
      {drops.map((doc, index) => (
        <Doc
          key={doc}
          className="drop"
          lines={5}
          style={vars({
            '--cycle': `${cycle}s`,
            '--d': `${index * DROP_EVERY_S}s`,
            '--r': `${(index % 2 ? 1 : -1) * (3 + (index % 3) * 2)}deg`,
          })}
        >
          {doc}
        </Doc>
      ))}
      <div className="ffront">
        <div className="sticker">
          <FoilLogo />
          {name && (
            <div className="box">
              <b ref={nameRef}>{name}</b>
            </div>
          )}
        </div>
        <span className="sub">{copy.folderLabel}</span>
      </div>
    </div>
  )
}

const Doc = ({
  className,
  lines,
  style,
  children,
}: {
  className: string
  lines: number
  style?: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element => (
  <div className={`sdoc ${className}`} style={style} aria-hidden>
    {children}
    {Array.from({ length: lines }, (_, index) => (
      <i key={index} />
    ))}
  </div>
)

// Step 3: the Meeting Briefing, and when to expect the first one. Nothing
// is generated here. "Remind me" is one tap, since we already have their
// number: the button says it is done, then the flow moves on.
export const BriefingStep = ({
  meeting,
  name,
  place,
  onRemind,
  onNext,
}: {
  meeting: FirstMeeting
  name: string | null
  place: string | null
  // They asked for the text. Saved behind the move, so it never holds it.
  onRemind: () => void
  onNext: (reminder: boolean) => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.briefing
  const offset = useEntranceOffset()
  const confetti = useConfetti()
  const remindRef = useRef<HTMLButtonElement | null>(null)
  const [reminded, setReminded] = useState(false)
  const promptRise = useRise(2300)
  const titleWords = accentWords(copy.title)
  const lede = copy.lede(place)

  const nextRef = useRef(onNext)
  nextRef.current = onNext

  useEffect(() => {
    if (!reminded) return
    const timer = setTimeout(() => nextRef.current(true), REMINDED_HOLD_MS)
    return () => clearTimeout(timer)
  }, [reminded])

  useDock('briefing', offset + 2700, [
    {
      key: 'skip',
      label: copy.noReminder,
      kind: 'outline',
      onClick: () => onNext(false),
    },
    {
      key: 'remind',
      label: reminded ? copy.reminded : copy.remind,
      kind: 'primary',
      disabled: reminded,
      className: reminded ? 'said' : undefined,
      content: reminded ? (
        <>
          <CheckIcon className="i" aria-hidden />
          {copy.reminded}
        </>
      ) : undefined,
      onElement: (element) => {
        remindRef.current = element
      },
      onClick: () => {
        setReminded(true)
        onRemind()
        if (remindRef.current) confetti.burst(remindRef.current, 44)
      },
    },
  ])

  return (
    <div className="ds-wrap">
      <Folder meeting={meeting} name={name} />
      <h1>
        <Words delay={600}>{accentParts(copy.title)}</Words>
      </h1>
      <p className="lede">
        <Words delay={1500} index={titleWords}>
          {lede}
        </Words>
      </p>
      <p className="lede prompt ui" style={promptRise}>
        <Words delay={2300} index={titleWords + lede.split(/\s+/).length}>
          {copy.remindPrompt}
        </Words>
      </p>
    </div>
  )
}
