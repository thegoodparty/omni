import { MessageSquareIcon } from '@styleguide'
import SheetSectionHeader from './SheetSectionHeader'
import type { ScriptIssue } from './doorScriptContent'

interface DoorScriptProps {
  intro: string
  issues: ScriptIssue[]
  // The stored card's bullets, when the list has one. Mutually exclusive with
  // `issues` by construction — see `useDoorScript`.
  points: string[]
  // Only to head the card, not to change what is in it — the hook decides
  // that. A Serve card with no stored points is the opener and can never be
  // anything else, so "Talking points" would name a thing that card does not
  // hold; a Win candidate who has written no issues yet still gets the Win
  // heading, because for them the list is empty rather than absent and the
  // editor is where they fill it. A Serve list WITH stored points is headed
  // like any other card that has them: the rail an official walks is the one
  // thing about it that changed least.
  isServe: boolean
}

// The canvas's first card in the panel body: `panelCard('Talking points',
// 'message-square', …)` — an intro line, then one bulleted line per issue, each
// a 6px dot against a 14px sentence.
//
// It used to be a collapsed disclosure pinned in the footer above the form,
// titled "Your talking points". Both are gone: the canvas draws this as a card
// at the top of the scrolling body with its section header like every other
// card, and a script behind a tap is a script nobody opens at a door. The
// footer keeps only what a canvasser ACTS on, which is the question ladder.
//
// **The canvas's own caption is deliberately not here.** It reads
// "AI-generated from this voter's profile and your candidate info.", and it is
// wrong about both halves for both cards this draws. The fallback card is the
// candidate's own issue stances, assembled by `doorScriptContent.ts` from what
// they wrote in the issues editor. The stored card was drafted by a model, but
// from the LIST — its purpose and the audience its filters select — and never
// from the resident whose door this is, and the candidate read and edited it
// in the wizard before it was frozen. Printing that sentence would tell a
// canvasser the lines in front of them were written about the person about to
// open the door.
export default function DoorScript({
  intro,
  issues,
  points,
  isServe,
}: DoorScriptProps) {
  // Nothing the candidate wrote, so nothing to say. An empty card would read as
  // a broken feature; the issues editor is where this gets fixed, not here.
  if (!intro && issues.length === 0 && points.length === 0) return null

  return (
    <section className="mb-4 rounded-xl border border-border">
      <SheetSectionHeader
        icon={MessageSquareIcon}
        title={
          isServe && points.length === 0 ? 'Introduction' : 'Talking points'
        }
      />
      <div className="flex flex-col gap-4 p-4 text-sm">
        {intro && <p>{intro}</p>}
        {points.length > 0 && (
          <ul className="flex list-none flex-col gap-2 p-0">
            {/* The card is frozen with the list and never reordered, and two
                sections can legitimately read alike — a purpose whose ask and
                whose engagement question circle the same event — so the
                position is the key rather than the text. */}
            {points.map((point, index) => (
              <li className="flex gap-2" key={index}>
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
        {issues.length > 0 && (
          <ul className="flex list-none flex-col gap-2 p-0">
            {/* Two stances can hang off one top issue, so the title is not a
                unique key. The list is static for the length of a walk — it is
                built once from the campaign, never reordered or spliced — so the
                position is a safe tiebreak. */}
            {issues.map((issue, index) => (
              <li className="flex gap-2" key={`${issue.title}-${index}`}>
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                <span>
                  {issue.title} — {issue.body}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
