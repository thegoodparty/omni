# Message composer and outreach disclaimers

Owner: Justin. Status: planned. Wave 0 is in progress; nothing past it is
built.

A plan for two things that turn out to be one thing: editable-but-protected
disclaimers in the SMS and robocall flows, and a reusable composer to hold them.

## The unifying idea

Both asks reduce to one editor that understands **protected content**: text the
user can write around but cannot delete or retype.

They are not the same kind of protected content, and the UI must not pretend
they are:

|                        | Merge tag              | Disclaimer                   |
| ---------------------- | ---------------------- | ---------------------------- |
| What it is             | a placeholder          | literal final text           |
| On screen vs delivered | differs                | identical                    |
| Rendering at rest      | pill                   | nothing, it is ordinary text |
| Rendering when blocked | shake plus tint        | shake plus tint              |
| Model                  | inline atom node       | protected text range (mark)  |
| Draggable              | yes                    | no                           |
| Deletable              | yes, unless `required` | no                           |

A pill announces "this will be swapped out." A disclaimer is not swapped out, so
a pill would misrepresent it. Two node types, one editor.

The disclaimer model gives exactly the requested behavior: the required phrase
is a protected span, the space before, after and between spans is the user's to
write in.

### Protected spans are invisible until you fight them

Decided: a protected span gets **no resting visual treatment**. It reads as
ordinary message text, because that is what it is. Protection is revealed only
on an attempt to change it.

On a blocked edit:

1. **Shake the span.** Use the existing `--animate-shake` token
   (`tailwind-theme.css:635`), whose own comment already names this use case:
   "an attempt to remove something that can't be removed." Attach the class,
   clear it in `onAnimationEnd`, and force reflow between remove and add so a
   rapid re-trigger restarts rather than skips. Reference implementation:
   `VoterMapCanvas.tsx:572-586`.
2. **Tint the span,** transiently, cleared with the animation. `text-destructive`,
   matching the compliance failure lines already rendered under this card.
3. **Say why,** in a live region.

**Reduced motion.** `tailwind-theme.css:888` records the house rule: animation
tokens stay unguarded, and "what the component applies on its own behalf is the
component's call to make." `TokenField` applies the shake on its own behalf, so
`TokenField` guards it. Under `prefers-reduced-motion: reduce` the shake is
dropped; the tint and the message stay.

**Accessibility, non-optional.** A shake and a color change are both invisible
to a screen reader, and color alone carrying meaning is a WCAG 1.4.1 failure.
The message text is what actually carries the meaning. Render it in the
existing inline compliance slot under the card with `role="status"` so it does
not interrupt typing. That slot is empty whenever an edit is blocked (a blocked
edit never lets the message enter a failing state), so it is free to use and
already reads as the right place for this. A toast is the alternative if inline
proves too easy to miss; sonner is already a styleguide dependency.

**Copy: do not overclaim.** The prototype says "required by law" for the opt-out
line. Paid-for-by is campaign finance law. The opt-out line is carrier rules
plus TCPA revocation rights, which is not the same thing, and in a compliance
product for candidates an overclaim is a trust problem. Give each span its own
accurate reason:

| Span                     | Message                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| opt-out                  | Every text has to offer a way to opt out. You can write around this line. |
| paid for by              | Campaign finance rules require this line. You can write around it.        |
| `{first_name}` (atom)    | The first name tag is required. You can move it, not remove it.           |
| candidate name           | Your name has to appear in the message. You can reword the rest.          |
| robocall name and office | A recorded call has to say who you are and what you are running for.      |
| robocall callback number | A recorded call has to give a callback number. Read it as written.        |

### Partial overlap is the one real design detail

Selecting across a protected boundary and typing is the common case, not the
edge case. Someone selects the whole message to rewrite it and starts typing.

Rejecting the whole transaction makes the field look broken. So: **apply the
deletable part, preserve the protected spans in place, shake them.** Select-all
plus type then leaves a message containing the disclaimers and the new text,
which is the right outcome and matches what the prototype does for required
pills.

This is the one place `filterTransaction` alone is not enough. A plain predicate
can only accept or reject; preserving spans inside a rejected range needs
`appendTransaction` or a step rewrite. Worth budgeting for.

### Discoverability tradeoff, noted

With no resting treatment, the user learns a span is protected by failing at it.
That is the accepted cost of having the disclaimer read as part of the message.
If it bites in testing, the cheapest mitigation that keeps the decision intact
is one quiet caption under the composer ("Some parts of this message are
required and can't be changed"), rather than per-span decoration.

**Simpler fallback if protected ranges prove fiddly:** a locked disclaimer block
with one free-text line beneath it. Less expressive, and for a legal region that
is not obviously a downside.

## Required elements, per channel

This is the atom spec. Nothing gets locked that is not on these lists.

### Peerly SMS (Win)

Five rules in `checkSmsStandards`, run identically client-side every keystroke
and server-side at scheduling.

| Rule id            | The actual test                                                                            | Satisfied today by                                |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `opt_out_line`     | `/reply\s+stop/i` anywhere in the composed script                                          | system footer `Reply STOP to opt out.`            |
| `first_name_token` | literal `{first_name}` present                                                             | the greeting `Hello {first_name},`                |
| `candidate_name`   | any whitespace-split token of 3+ chars from the candidate's name appears, case-insensitive | the identification sentence, in the editable body |
| `paid_for_by`      | `/paid\s+for\s+by/i` **and** a 3+ char token of the committee name                         | system footer `Paid for by <committee>.`          |
| `length`           | composed script under 2000 (`P2P_SCRIPT_MAX_LENGTH`)                                       | UI caps earlier at 1000                           |

Not in the standards check but still required: Peerly rejects a P2P job with no
image (`P2P_ERROR_MESSAGES.IMAGE_REQUIRED`).

The name matched by `candidate_name` is `campaign.ownerName` on both sides, not
the composing user (fixed in `5c1c95269`).

### CallHub robocall

**No merge tags exist, structurally.** CallHub receives one pre-recorded audio
file (`script.live_message.audiofile`) played to everyone. The script text never
leaves our system.

Three checks on the recording, fail-closed:

| Check                   | What it verifies                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `hasSelfIdentification` | speaker names themselves (first name suffices) **and** says they are running for or seeking office |
| `hasOrganization`       | the call states who is responsible for or paid for it                                              |
| `hasCallbackNumber`     | a phone number is spoken; presence only, not matched against the rented number                     |

Plus: no "Reply STOP" (voice call), 60s max, 15 MB max, MIME allowlist, and the
verdict is bound to the audio's S3 ETag.

## The span spec

### The principle: lock the minimum the validator tests for

Each protected span should be exactly the thing the check looks for, and no
more. Everything else stays the candidate's to write. Two consequences worth
naming, because they are not obvious:

- `candidate_name` only requires a 3+ char token of the name to appear
  **anywhere**. So the span is the name itself, not the identification
  sentence. The candidate can reword their whole intro and only loses the
  ability to delete their own name.
- `opt_out_line` only tests `/reply\s+stop/i`, not the words "to opt out".

### But break a span only where there is a real reason to write inside it

That is the exception to the principle above. Paid-for-by earns a break:
several states add requirements to the disclaimer (an address, "not authorized
by any candidate"), so a candidate genuinely needs to write inside it. The
opt-out sentence earns none: nothing legitimate goes in the middle of "Reply
STOP to opt out." So that one stays a single span even though the validator
would accept less.

### SMS spans (Win)

| Rule               | Protected span                                  | Editable around it                | Broken because                                                       |
| ------------------ | ----------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `first_name_token` | `{first_name}` atom                             | yes                               | it is a placeholder, so it is a pill, not a span                     |
| `candidate_name`   | the candidate's name, one anchored instance     | the whole identification sentence | the rule only needs the name present, so the wording is theirs       |
| `paid_for_by`      | two spans: `Paid for by` and the committee name | before, between, after            | state law adds requirements, so candidates need to write inside this |
| `opt_out_line`     | `Reply STOP to opt out.`, one span              | before and after                  | nothing goes inside it                                               |
| `length`           | none                                            | none                              | a counter, not a span                                                |

Serve SMS: the `{{first_name}}` atom, the name span, the opt-out span. No
paid-for-by, because there is no committee.

### Robocall spans

Broken up the same way, and for the same reason: candidates need to add to the
spoken disclosure.

| Check                   | Protected spans                                    | Editable around it             |
| ----------------------- | -------------------------------------------------- | ------------------------------ |
| `hasSelfIdentification` | the candidate's name; and `candidate for <office>` | yes, the rest of the opener    |
| `hasOrganization`       | `Paid for by`; and the sponsor name                | yes, before, between and after |
| `hasCallbackNumber`     | the formatted number                               | yes                            |

Standing caveat: robocall spans are advisory. The gate is the recording verdict,
not the script. Spans reduce failed recordings; they cannot guarantee a passing
one.

### The span list is derived, never hand-written

One function computes the spans from the same `(script, context)` inputs
`checkSmsStandards` already takes, and lives beside it in contracts. A rule
change then updates the lock and the verdict together, and they cannot drift
apart.

This also means the list is **per campaign and legitimately sometimes empty**:

- A candidate whose name has no token of 3+ chars (Al, Bo) produces no
  `candidateTokens`, so `candidate_name` never runs and there is nothing to
  protect.
- With no committee name, `paid_for_by` still demands the phrase but the
  committee-token half passes vacuously, so only the phrase gets a span.

Hand-maintaining this list would get one of those wrong.

### Side benefit

Today deleting the identification sentence is allowed, and the candidate finds
out from a validation line after the fact. Protecting the name converts a
post-hoc block into in-the-moment feedback, which is the whole point of the
change.

### Merge tags: available versus required

Only `{first_name}` is required, and it is the only tag we emit. But Peerly's
CSV carries six columns, so six merge fields are available and unused:

```
P2P_PHONE_LIST_MAP = { first_name, last_name, lead_phone, state, city, zip }
```

`{last_name}`, `{city}`, `{state}` and `{zip}` could be offered with no vendor
work. A registry is what makes that a config change.

## What exists today

### SMS (Win)

Three system-owned regions wrap the editable body:

| Region                                                | Where it lives                     | Editable                             |
| ----------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| `Hello {first_name},`                                 | pill above the field               | no                                   |
| identification sentence                               | prepended _into_ the editable body | yes, and deleting it blocks Continue |
| `Paid for by <committee>.` + `Reply STOP to opt out.` | muted text below the field         | no                                   |

`composeScript(body, committeeName)` in `v2/sms/smsCompose.util.ts` concatenates
the three. `checkSmsStandards`
(`packages/contracts/src/outreach/SmsAdminConsole.schema.ts`) runs on the
composed string every keystroke and hard-blocks Continue.
`requireCompliantScript` in `gp-api/src/outreach/services/outreach.service.ts`
runs the **same contract function** server side at scheduling.

Committee name comes from `TcrCompliance.committeeName`, typed once at 10DLC
registration. `POST /tcr-compliance` 409s if a row exists and there is no
candidate-facing update route, so after registration only staff can change it
(`PATCH /campaigns/tcr-compliance/admin/:campaignId/committee-name`).

### Serve SMS

Opt-out line only, double-brace `{{first_name}}`, `paid_for_by` rule ignored.
**No server-side standards check exists on the Serve create path.**

### Robocall

The disclosure is not a region at all. It is an instruction in the LLM prompt
(`DISCLOSURE_RULE`, `outreachRobocallGeneration.service.ts`) telling the model to
end the script with "Paid for by ..., <callback number>". The script is stored
as display/record-only. Enforcement is entirely after the fact: transcribe the
recording, then an LLM verdict on self-ID, organization, and a spoken number.

Two consequences:

1. **The custom path has no disclosure at all.** Generation refuses fresh drafts
   for `custom`, so "Write my own script" is an empty box plus a hint line. The
   user learns it was non-compliant only after recording, uploading, and
   transcription.
2. **The two channels name different sponsors.** SMS uses
   `TcrCompliance.committeeName`. Robocall uses `${candidateName} for ${office}`,
   falling back to the literal `'the campaign'`.

## Duplication evidence

Four near-identical outreach composers: social, SMS, phone banking, robocall.
Same Card, same `-mx-4 -mb-4 mt-4 ... border-t p-2` toolbar, tone pill records
duplicated verbatim in three files.

The clinching example: on 2026-09-22 commit `2dd1e27fb` fixed a WCAG 2.4.7
failure on the SMS textarea, where `focus-visible:ring-0` made an editable draft
read as static text. The byte-identical broken class string is still in:

- `v2/social/ComposeStep.tsx:159`
- `v2/phone-banking/ScriptStep.tsx:197`
- `v2/robocall/RobocallComposeStep.tsx:222`

The fix reached one of four copies. Also: four hand-rolled dictation mic buttons
despite a shared `DictationMicButton`; three char-counter implementations, none
in the design system; four different treatments of a locked system region
(muted `<p>` in SMS, `ComposedSection` in door-knocking talking points, a
`disabled` Input in polls, prose baked into AI output in robocall).

## Architecture

Three layers. The boundary rule: styleguide owns presentation and a11y and knows
nothing about compliance or AI; gp-webapp owns behavior.

### Layer 1: styleguide primitives

**`textarea.tsx`, add a variant.** `variant?: 'default' | 'seamless'`. Seamless
is borderless with no padding and keeps the focus ring. Plain prop plus
conditional `cn()`, not cva, matching the existing `autoGrow` line. Kills the
duplicated hack and the WCAG bug in one place. Still needed after the rich
editor lands, because most of the 12 long-form surfaces stay plain textareas.

**`token-field.tsx` → `TokenField`.** The merge-tag editor, built on TipTap 3
(`@tiptap/react` + `@tiptap/core`, already a gp-webapp dependency via the
ordinances redline editor). Fully controlled:

```ts
// A placeholder. Renders as a pill because the label differs from what the
// recipient sees.
interface TokenSpec {
  id: string
  label: string // what the pill shows
  text: string // what serializes to plain text
  required?: boolean // cannot be deleted
}

// Literal final text the user may write around but not edit inside.
// No resting treatment: it renders as ordinary text, never a pill.
// `reason` is surfaced by the caller when an edit is blocked.
interface ProtectedSpec {
  id: string
  text: string // matched and locked verbatim
  reason: string
}

interface TokenFieldProps {
  value: string
  onChange: (value: string) => void
  tokens?: TokenSpec[]
  protectedRanges?: ProtectedSpec[]
  // Fired on a blocked edit. The field owns the shake and the transient
  // tint; the caller owns the message, so no copy lives in the styleguide.
  onBlockedEdit?: (target: TokenSpec | ProtectedSpec) => void
  placeholder?: string
  readOnly?: boolean
  'aria-label'?: string
}

interface TokenFieldRef {
  insertToken: (id: string) => void
  insertText: (text: string) => void
  focus: () => void
}
```

**`token-pill.tsx` → `TokenPill`.** The chip itself, so previews and review
steps render the same pill without duplicating styles.

### Layer 2: styleguide composite

**`message-composer.tsx` → `MessageComposer`.** The card shell, stateless, no
hardcoded copy, every string a prop. Named `ReactNode` slots: `media`, `label`,
`meta` (counter), `prefix`, `children` (the field), `suffix` (locked footer),
`toolbar`, `footer` (validation). `className` on the Card.
`data-slot="message-composer"`.

### Layer 3: gp-webapp behavior

`app/dashboard/shared/composer/`:

- `useComposerDraft` wrapping the five `POST /v1/outreach/*/draft` endpoints,
  which already share an identical `requestDraft(purpose, tone?, currentDraft?)`
  shape with the same `custom` guard and the same 502 handling.
- The tone pill group, currently duplicated verbatim in three files.
- The dictation button: use the existing shared `DictationMicButton` rather than
  a fifth hand-rolled copy.
- Per-channel config objects, following the existing `SmsFlowSurface` pattern.

## Editor engine: the options

ProseMirror models a document as a typed tree and delivers every change as a
transaction you can reject before it applies. TipTap is a headless React
wrapper plus an extension system over it. No UI you did not ask for.

| Option                          | Verdict                                                                                                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TipTap / ProseMirror**        | Recommended. Already a gp-webapp dependency (ordinances redline editor), so no new dep and a working in-repo example. `filterTransaction` is exactly the mechanism needed.                                              |
| **Lexical** (Meta)              | The strongest alternative. Same capability, newer, excellent performance. Worth it only if starting clean; not worth a second editor engine here.                                                                       |
| **Slate**                       | Flexible React-first data model, but you own more editing behavior yourself and it has historically been weakest on mobile and IME.                                                                                     |
| **Quill 2**                     | Already a dependency (legacy `RichEditor`). Has embeds, but the API is imperative, protecting ranges is awkward, and the repo is drifting off it.                                                                       |
| **Hand-rolled contenteditable** | The Lovable approach. Cheapest start, most expensive to own, leans on the deprecated `document.execCommand`.                                                                                                            |
| **No editor at all**            | Plain textarea; detect a missing element with `checkSmsStandards` and block Continue instead of preventing the keystroke. Exactly how the identification line behaves today. Legitimate if the pills are not the point. |

## Why TipTap and not the Lovable contenteditable

The handoff's `MergeTagEditor` hand-handles each deletion case with `beforeinput`
and `keydown`, and leans on `document.execCommand`, which is deprecated. It still
misses paths (drag a required pill out of the field, undo after a blocked
delete, IME composition).

ProseMirror gives us the whole thing as one function. Define the token as an
inline node with `atom: true`, then:

```ts
filterTransaction: (tr, state) =>
  countRequired(tr.doc) >= countRequired(state.doc)
```

That single predicate covers backspace, delete, select-all-delete, cut,
paste-over, drag-out, and undo. The consumer gets `onBlockedRemoval` and decides
the shake and the toast, so the styleguide component stays copy-free.

**The wire format does not change.** Serializing the doc maps each token node to
its `text` attr, producing the same flat string Peerly already receives, with the
literal `{first_name}` in it. `checkSmsStandards` keeps running on that string,
client and server, unchanged. This is a UI change on top of an untouched
contract, which is how something that sounds risky stays low risk.

## Answering "is this just client-side validation?"

No, and it does not need to be.

- **Win SMS:** the server already re-runs the identical `checkSmsStandards` at
  scheduling. A user who defeats the editor still cannot schedule. Already
  covered.
- **Serve SMS:** no server check exists. If the footer becomes editable there,
  add one to `outreachServeSmsCreate.service.ts`. That means moving
  `ignoredStandardsRules` out of `SERVE_SMS_SURFACE` and into contracts so both
  sides agree on which rules apply.
- **Robocall:** the script is display-only and the real gate is the audio
  verdict, so text-level checks there are advisory by nature. Say so rather than
  implying the script is enforced.

So the locked atoms are an affordance. Enforcement stays where it already is.
One gap to close.

## Robocall: take the disclosure away from the LLM

Same shape as SMS, with the model out of the loop.

1. Add a deterministic `robocallDisclosureLine(paidForBy, callbackNumber)`
   alongside `paidForByLine`.
2. Delete `DISCLOSURE_RULE` and `IMPROVE_DISCLOSURE_RULE` from the generation
   prompt. Keep `COMPLIANCE_BAN_RULE` on unconditionally, so the model never
   writes disclosure text in either mode. Keep `IDENTIFICATION_OPENER_RULE`,
   because self-ID is body content, not footer.
3. Render the disclosure as **protected spans, broken up** (see the span spec),
   for every purpose including `custom`. That closes the empty-box hole and
   lets a candidate add their state's extra requirements inside the disclosure.
4. Caption it as an instruction to read the line as written, not as system text.

### Where "same as SMS" cannot hold

- **The required elements differ.** SMS needs opt-out, `{first_name}`, the
  candidate name, and paid-for-by. Robocall needs self-ID with "running for" or
  "candidate for", the organization, a spoken callback number, and explicitly
  **no** "Reply STOP", because it is a voice call.
- **A locked script atom cannot guarantee compliance**, only make it likely. The
  recording verdict still runs and still fails closed.

## Rollout

| Wave | Work                                                                              | User-visible                                                    |
| ---- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 0    | `Textarea` seamless variant, applied to all four composers                        | Fixes the missing focus ring in social, phone banking, robocall |
| 1    | `TokenField`, `TokenPill`, merge-tag registry, stories, tests                     | None, no call sites yet                                         |
| 2    | `MessageComposer` shell plus the gp-webapp behavior layer. Migrate SMS first      | SMS footer becomes editable-with-locked-atoms                   |
| 3    | Robocall: deterministic disclosure, prompt change, locked atom, custom path fixed | Custom scripts stop failing after the recording                 |
| 4    | Social, phone banking, door-knocking talking points onto the shell                | Consistent toolbar and counter                                  |
| 5    | Optional: chat composers, polls                                                   |                                                                 |

Wave 0 stands alone and is worth landing regardless of the rest.

## Merge tags deserve a registry, not just a component

Today the single-brace vs double-brace difference is a comment in
`smsCompose.util.ts` plus conversion logic in `polls/create/CreatePoll.tsx`.
Get it wrong and a constituent is texted the literal token. Put the registry in
contracts, keyed by fulfilment channel:

```ts
{ id: 'first_name', label: 'First name', sample: 'Sam',
  token: { peerly: '{first_name}', serve: '{{first_name}}' } }
```

`TokenPill` renders one, `TokenField` edits them, and the brace question has one
answer in one place.

## Risks

- **Protected spans and AI rewrites fight each other. This is the big one.**
  Putting a span inside the body means it now lives in text the model rewrites.
  Every draft, regenerate, tone change and Improve returns plain text carrying
  no span information, so a naive pipeline loses the lock on each round-trip, or
  worse, the model drops the candidate's name and there is nothing left to lock.

  Fix: **never let the model write a protected span.** The AI only ever
  authors the free text. For SMS the intro and footer are already composed
  around the draft, so this mostly holds today; it has to hold for Improve too,
  which by nature rewrites everything. Send the full composed message to the
  model as context, ask it to return only the editable region, and reassemble
  deterministically. Re-anchoring by string match after the fact is the
  fallback, not the plan, and it needs a defined behavior for a span that comes
  back missing (re-insert at its canonical position).

  Same rule retires `DISCLOSURE_RULE` from the robocall prompt, which is
  already the plan for other reasons.

- **Which occurrence gets protected.** The validator needs one match anywhere,
  so one anchored instance is protected. If the candidate types their own name
  again elsewhere, that copy is plain text and deletable. Predictable, but
  someone will report it.
- **Test selectors.** Flow tests use `getByRole('textbox', { name: 'Robocall
script' })` and `aria-label="Message body"`. A contenteditable exposes
  `role="textbox"` if we set it, so preserve the aria-labels exactly.
- **jsdom and ProseMirror.** jsdom does not lay out and ProseMirror needs real
  ranges. Check how `RedlineEditor.test.tsx` copes before committing to heavy
  unit tests. Flow-level tests may need a mocked field.
- **Sizing.** `[field-sizing:content]` and `autoGrow` do not apply to a
  contenteditable. It needs its own height handling.
- **Emoji picker.** `emoji-picker-react` is a new dependency and `product-copy.md`
  says no emoji. Leave it out of wave 1 and treat it as its own product
  decision.
- **List buttons.** In an SMS a bullet is just a character. Insert plain text,
  as the Lovable version does. Do not enable StarterKit list nodes.
- **Documented decision reversal.** `outreach/AGENTS.md` records that the footer
  is "deterministic, never left to the candidate or the LLM" as a product
  decision from 2026-09-02. Making it editable reverses that. It needs to be a
  conscious call and the doc needs updating in the same change.

## Decisions taken

1. **Sponsor mismatch: resolved.** Robocall uses `TcrCompliance.committeeName`
   when present, falls back to "{candidate} for {office}", and never emits the
   literal `'the campaign'`.
2. **Serve SMS: editable disclaimer, no server-side check.** Paid-for-by is
   genuinely candidate-only, so it does not apply to an elected official. The
   opt-out line is not a candidate rule, it attaches to the sender, but Serve's
   real protection sits elsewhere: the send path scrubs opted-out person ids at
   send time and fulfilment goes through a human with a CSV. The text line is
   belt and braces there, not the guard. Recorded as a deliberate choice.
3. **Required fields: settled**, see the atom spec above.

## Follow-ups, deliberately out of scope

- **Tone pills and Regenerate belong in the toolbar.** Today they float above
  the card as loose controls acting on the thing below them, which reads as
  unrelated chrome. Once `MessageComposer` exists this is a config change
  against the `toolbar` slot, not a rewrite.
- **Offering the other five Peerly merge fields** (`last_name`, `city`,
  `state`, `zip`, `lead_phone`).
