# Email templates

`renderEmailTemplate(content, context)` turns an email's block content (`EmailContentDraft` from `@goodparty_org/contracts`: a layout preset, a theme, a subject and ordered blocks) plus what the system adds (`context`: sender name, Win's paid-for-by, send date) into `{ html, text, subject }` for an SES template. Why blocks: `docs/adr/2026-10-30-email-content-typed-blocks.md`. Design: TDD subproblem 3 ("Templates", "Footer"), ClickUp doc `2ky4jq2q-20493`.

## Key files

| Path                         | Purpose                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `renderEmailTemplate.tsx`    | The one entry point. Checks content with `EmailContentDraftSchema`, protects user text, drops empty blocks, renders html and text |
| `layouts/*.tsx`              | One treatment per preset (`short_cta`, `long_update`, `personal_letter`); each takes `{ colors, blocks, context }`                |
| `components.tsx`             | Shell, block pieces (heading, paragraph, full and inset image, button, text link, divider) and the footer                         |
| `emailVariables.util.ts`     | Keeps `{{first_name}}` and `{{last_name}}` as variables and escapes every other brace                                             |
| `emailTemplate.const.ts`     | The postal address and the three template variable names                                                                          |
| `emailThemeContrast.test.ts` | WCAG AA check over every text-on-background pair the layouts draw; `KNOWN_FAILURES` lists palette gaps no layout draws            |

## Layout treatments

The layouts differ by treatment, not by fields. Every theme works with every layout.

- **`short_cta`**: bold and centered. A theme-color strip, the photo edge to edge, a 36px centered headline, centered paragraphs, and the button in the theme's accent on a band of the theme color (`rule`). The footer is centered.
- **`long_update`**: a theme-color masthead (`header`) with the level 1 heading, then `<sender> · <Month d, yyyy>`. The sender and date come from `context`, never the author; the date is the send's date (or now for send-now, test and preview). Then the optional photo full width, left-aligned 17/28 reading text, level 2 subheadings in the theme color (`rule`), dividers and a smaller `cta` button.
- **`personal_letter`**: a plain email on a white page (`card`, not the theme tint), no header or banner. Paragraphs, the button as an underlined `cta` link, and the photo padded and centered at 78% of the column, first or last.

## Rules

- **Template variables are `{{first_name}}`, `{{last_name}}` and `{{unsubscribe_url}}`.** The first two come from user text; the unsubscribe link is the footer's own placeholder and is filled per recipient at send time. The schema rejects any other `{{tag}}`; any brace that still reaches the renderer (a single `{`, `{{{first_name}}}`, the sender name) is escaped (`&#123;` in html, a zero-width space in text, placed before a `}` so a merge tag never reads as `}}}`, `%7B` in a URL), because SES templates are Handlebars.
- **What is sent is checked against `EmailContentSchema` first** (`util/emailContent.util.ts` `sendableContentOf`, at confirm, test send and prepare). This renderer only enforces the draft schema, so a preview can show an unfinished draft; a button without its link yet points to `#`.
- **Every block carries a solid `bgcolor` attribute plus a CSS background,** and the head declares `color-scheme: light only`. Every class a block uses has its light color repeated in `darkModeCss`. Don't drop either when adding a block; dark-mode clients recolor anything without them.
- **The footer is system-owned and inside the card.** Win passes `paidForBy` and gets "Paid for by"; Serve passes null and gets no line. The postal address, the reason line and the unsubscribe link are always there. The reason line uses no Win or Serve nouns, so it needs no mode-keyed copy.
- **A new preset needs a contracts entry (`EMAIL_LAYOUT_PRESETS`, `checkEmailLayout`) and a case in `LAYOUTS`.** A new theme is a contracts entry only; never edit a shipped theme key in place.

## Manual rendering pass

`scripts/send-all-email-templates.ts` sends each layout's Win or Serve example in every theme to team inboxes through dev SES (`npx tsx scripts/send-all-email-templates.ts --confirm-dev --to you@goodparty.org`, from a dev AWS session). Run it after any layout or theme change and look at the results in Gmail, Outlook and Apple Mail, light and dark. The dev gallery (`gp-webapp` `/dev/email-templates`) shows the same examples through the preview endpoint.

## Gotchas

- These are `.tsx` files. `tsconfig.json` sets `jsx: react-jsx`, and the `.swcrc` plus `nest-cli.json`'s `extensions` make `nest build` compile them. Without those, `.tsx` files silently stay out of `dist`.
- `React` text children split into separate nodes with `<!-- -->` comments; build a footer or masthead line as one template string if a test or client must match it.
- The example images (`EMAIL_SAMPLE_IMAGE_URLS`) are files in `gp-webapp/public/images/email-samples/`, served from `app.goodparty.org`. `assertEmailImageUrl` accepts exactly those besides an organization's own uploads.
