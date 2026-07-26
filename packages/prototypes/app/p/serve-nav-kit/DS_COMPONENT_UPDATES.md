# Styleguide component backlog — from serve-nav-kit

What the design system (`@goodparty_org/styleguide`) needs, discovered while porting the
Lovable app into this prototype. Two parts:

- **Part A — updates to existing DS components** (a prop/variant is missing).
- **Part B — new components created locally** (no DS equivalent; candidates to add).

Each item is a candidate for a **separate, design-reviewed styleguide PR**. The prototype
works around it locally until it lands. Keep this file updated as new gaps appear.

---

## Part A — updates to existing DS components

### Badge

- **Add `info` / `success` / `warning` variants.** Those colour families exist as tokens
  and `Alert` already exposes them as cva variants, but `Badge` does not. Channel pills
  tint via a prototype-local className (`CHANNEL_TINT`) as a stand-in.
- **No numbered-circle shape.** Door-knocking stop lists need a fixed circular
  badge with a 1–2 digit number inside (`size-6 rounded-full`). `shape="pill"`
  (`h-5 min-w-5`) turns into an oval for two digits, so we hand-roll a
  `<span className="size-6 rounded-full bg-muted text-foreground …">` circle
  instead (see `WalkMode.tsx` / `NewListFlow.tsx`, matching the source). A
  `shape="circle"` / count-badge variant would make this first-class.

### FilterPill

- **Default icon↔label gap.** With icon + text children the two sit flush; we add
  `className="gap-1.5"`. A built-in gap (like `Button`'s `gap-2`) would match expectations.
- **No status/colour indicator slot.** The door-knocking map legend is a
  `FilterPillGroup` where each pill needs a coloured status dot (Supporter=green,
  Non-supporter=red, Not home=yellow, …). FilterPill has no built-in leading
  indicator, so we render a `<span className="size-2.5 rounded-full …">` dot as the
  first child (see `screens/door-knocking/Legend.tsx`). A first-class `indicator`/
  `dot` prop (or a documented "coloured legend pill" pattern) would make this
  first-class instead of a local extension. Counts follow the DS `Label (N)`
  convention as plain label text.

### Drawer

- **Height / top-offset control.** To open a bottom drawer flush with the app header
  bottom we override the built-in `data-[vaul-drawer-direction=bottom]:mt-24` and
  `max-h-[80vh]` (same data-variant prefix so twMerge wins). A `maxHeight` / `topOffset`
  prop would make this first-class.

### PageHeader

- **No desktop-visible main-bar actions slot.** `trailing` is `lg:hidden`, so desktop
  screen actions fall to the sub-bar. A first-class desktop actions slot would help.

### (Note) Stepper, Button, Input, Select, Calendar, Accordion, Popover, Alert, Card,

Textarea, Toaster, IconButton, Avatar, ContentCard, SourceCitation, Collapsible, Switch,
Label, Pagination, Table, DropdownMenu, Sidebar — **exist and are used as-is.** e.g. the
SMS "Step N of 5" bar is DS `Stepper variant="bar"` (was briefly hand-rolled, now fixed).

### Calendar / date picker

- **DS `calendar-button` exists.** The campaign flows currently hand-roll the date
  trigger as an outline `Button` styled to look like an Input
  (`bg-components-input-base border-components-input-border …`) inside a `Popover` +
  `Calendar`. They should migrate to the DS `calendar-button` instead of painting raw
  `components-input-*` tokens. Deferred (approved flows; behavioural refactor) — tracked here.

### Resolved this pass

- **`shadow-none` on `Card`** removed everywhere — the DS `Card` has no default shadow,
  so it was a no-op.
- **Destructive menu items** use `DropdownMenuItem variant="destructive"` (was
  `className="text-destructive …"`).
- **Field error state** uses `aria-invalid` (Select + date Button); the DS paints the
  destructive border/ring. Manual `border-destructive text-destructive` removed.
- **Selectable option tiles** (audience / tone / platform cards) are **outline +
  checkmark only** — no `bg-muted` fill on selection (product decision).
- **List / turf colors** use the DS categorical `--data-chart-*` palette (was raw
  `--color-<family>-<shade>` tokens); labels follow the actual DS hues.

### Intentional raw-palette exceptions (no semantic / data-chart token fits)

- `bg-yellow-400` / `fill-yellow-400` — the "Not home" status colour (source's exact
  `48 96% 53%`); the DS has no semantic yellow token.
- `bg-emerald-50` — the synthetic map's muted, Google-Maps-style green background.

---

## Part B — new components created (candidates for the DS)

Local components built because the DS has no equivalent. Path is
`app/p/serve-nav-kit/` (components/ or screens/outreach/).

| Component                                      | What it is                                                                                                                                                                                                                                                               | Built from                                                                                                                                                                           | Promote to DS?                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `SectionLabel`                                 | Section eyebrow/overline; mirrors ContentCard's built-in eyebrow (`text-primary text-xs font-bold uppercase`) as a **standalone** element.                                                                                                                               | `p` + tokens                                                                                                                                                                         | Yes — a shared `Eyebrow`/`Overline`.                                                       |
| `ChannelBadge`                                 | Channel chip reused in table/cards/drawer. Ready `Badge` + a per-channel token tint.                                                                                                                                                                                     | `Badge`                                                                                                                                                                              | Only if Badge gains info/success/warning variants (Part A).                                |
| `StatusIndicator`                              | Outreach status = blue icon + label (`text-xs`), reused everywhere.                                                                                                                                                                                                      | `span` + tokens + lucide                                                                                                                                                             | Maybe — a small `StatusText`.                                                              |
| `ChannelCard`                                  | Centered icon-in-circle selectable tile with Pro lock + per-channel bg tint; keyboard-operable.                                                                                                                                                                          | `Card` + `ProBadge` + lucide                                                                                                                                                         | Candidate `IconTile` / `ChannelTile`.                                                      |
| `StatRows`                                     | "Label → big number" rows in one card (voter universe).                                                                                                                                                                                                                  | `Card` + `Separator`                                                                                                                                                                 | Candidate `StatList`.                                                                      |
| `Metric`                                       | Icon + label + value card (drawer overview/progress/payment grids).                                                                                                                                                                                                      | `Card` + tokens                                                                                                                                                                      | Candidate `Metric` / `StatTile`.                                                           |
| `PathToVictoryMeter`                           | Two-segment "so far / to win" progress meter with a threshold marker. `Progress` is single-value only.                                                                                                                                                                   | `div`s + tokens + inline width styles                                                                                                                                                | Candidate `SegmentedProgress` / `GoalMeter`.                                               |
| `ImageUploadField`                             | Label + preview + upload button for cover/avatar.                                                                                                                                                                                                                        | `Button` + `Label`                                                                                                                                                                   | Candidate `ImageUploadField`.                                                              |
| Image dropzone (inline, SMS StepWhat)          | Dashed drop area → file picker → `FileReader` preview + remove.                                                                                                                                                                                                          | `button` + `input[type=file]` + tokens                                                                                                                                               | Candidate `Dropzone` / `FileUpload`.                                                       |
| Merge-var pill (inline, `renderWithMergeVars`) | Inline `{token}` tag inside text; light-blue tint readable on light + dark bubble.                                                                                                                                                                                       | `span` + tokens                                                                                                                                                                      | Candidate inline `Tag` / `Token`.                                                          |
| `AiPromptBar`                                  | Rebuild of gp-webapp's AiChat bar (conic-gradient pill + IconButtons). **AiChat isn't exported from the styleguide** — lives in gp-webapp.                                                                                                                               | `IconButton` + `AiIcon` + `MicIcon` + gradient tokens                                                                                                                                | Yes — **promote AiChat into the styleguide** so any package can import it.                 |
| `SmsCampaignFlow`                              | 5-step SMS campaign builder (Purpose → Who → When → What → Review) in a `Drawer`, backend-free.                                                                                                                                                                          | DS `Drawer`, `Calendar`, `Select`, `Popover`, `Accordion`, `Textarea`, `Stepper`, `FilterPill`, `Button`, `IconButton`, `Input`, `Label`, `Alert` + `smsData` + `useSpeechDictation` | Product-specific — stays in the app, but its sub-pieces above are the reusable candidates. |
| `useSpeechDictation` (hook)                    | Backend-free voice dictation via the browser Web Speech API.                                                                                                                                                                                                             | Web Speech API                                                                                                                                                                       | Candidate DS/util hook.                                                                    |
| `SignatureEditor` (in EmailCampaignFlow)       | Minimal rich-text editor (contentEditable + Bold/Italic toolbar) for the email signature. No DS rich-text/WYSIWYG editor exists.                                                                                                                                         | `contentEditable` + `IconButton` + `document.execCommand`                                                                                                                            | Candidate `RichTextEditor` / `SignatureField`.                                             |
| `EmailCampaignFlow`                            | 6-step email campaign builder (Purpose → Who → When → What → **Preview** → Review), backend-free, free cost. Same DS shell as `SmsCampaignFlow`; adds subject `Input`, `SignatureEditor`, an email-mockup preview step. Shares audiences/tones/pools/dictation with SMS. | DS `Drawer`/`Stepper`/`FilterPill`/`Calendar`/`Select`/`Accordion`/`Input`/`Textarea` + `emailData`                                                                                  | Product-specific; sub-pieces are the reusable candidates.                                  |

**Housekeeping:** `StatTile` (in `components/Stats.tsx`) is currently **unused dead code**
— delete it (only `StatRows` is used). Pending user go-ahead.
