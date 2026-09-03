import { MessageSquareIcon } from '@styleguide'
import SheetSectionHeader from './SheetSectionHeader'
import type { ScriptIssue } from './doorScriptContent'

interface DoorScriptProps {
  intro: string
  issues: ScriptIssue[]
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
// "AI-generated from this voter's profile and your candidate info.", and
// nothing in this product generates these lines: they are the candidate's own
// issue stances, assembled by `doorScriptContent.ts` from what they already
// wrote in the issues editor. Printing the canvas's sentence would describe the
// feature as something it isn't, on the one surface a canvasser reads out loud.
export default function DoorScript({ intro, issues }: DoorScriptProps) {
  // Nothing the candidate wrote, so nothing to say. An empty card would read as
  // a broken feature; the issues editor is where this gets fixed, not here.
  if (!intro && issues.length === 0) return null

  return (
    <section className="mb-4 rounded-xl border border-border">
      <SheetSectionHeader icon={MessageSquareIcon} title="Talking points" />
      <div className="flex flex-col gap-4 p-4 text-sm">
        {intro && <p>{intro}</p>}
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
