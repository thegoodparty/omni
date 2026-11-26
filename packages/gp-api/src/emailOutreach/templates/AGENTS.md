# Email templates

`renderEmailTemplate(content, context)` turns an email's block content (`EmailContentDraft` from `@goodparty_org/contracts`: a layout preset, a theme, a subject and ordered blocks) plus what the system adds (`context`: sender name, Win's paid-for-by, send date) into `{ html, text, subject }` for an SES template. Why blocks, why the original layouts never refuse them, and why `photo_letter` is a fixed structure beside them: `docs/adr/2026-11-25-email-photo-letter-is-a-fixed-structure.md`. Design: TDD subproblem 3 ("Templates", "Footer"), ClickUp doc `2ky4jq2q-20493`.

## Key files

| Path                                   | Purpose                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `renderEmailTemplate.tsx`              | The one entry point. Checks content with `EmailContentDraftSchema`, protects user text, drops empty blocks, renders html and text  |
| `layouts/*.tsx`                        | One treatment per preset (`short_cta`, `long_update`, `personal_letter`, `photo_letter`); each takes `{ colors, blocks, context }` |
| `components.tsx`                       | Shell, block pieces (heading, paragraph, full, inset and column image, buttons, divider, signature) and the footer                 |
| `renderEmailTemplate.snapshot.test.ts` | Snapshots of the original presets' examples: any change to their html or text fails it                                             |
| `emailVariables.util.ts`               | Keeps `{{first_name}}` and `{{last_name}}` as variables and escapes every other brace                                              |
| `emailTemplate.const.ts`               | The postal address and the three template variable names                                                                           |
| `emailThemeContrast.test.ts`           | WCAG AA check over every text-on-background pair the layouts draw; `KNOWN_FAILURES` lists palette gaps no layout draws             |

## Layout treatments

The original three layouts differ by treatment, not by fields. Every theme works with every layout, and every layout draws every block it is given, in order, except the placements below. A photo after a paragraph or the button was moved to the bottom by the sender, and every layout draws it last, before the footer.

- **`short_cta`**: bold and centered. A theme-color strip, the photo edge to edge above the text (or under the button's band when it is at the bottom), 36px centered level 1 headings, centered paragraphs, subheadings and dividers, and the button in the theme's accent on a band of the theme's `band` color (else `rule`). The footer is centered.
- **`long_update`**: a theme-color masthead (`header`) with the first level 1 heading, then `<sender> · <Month d, yyyy>`. The sender and date come from `context`, never the author; the date is the send's date (or now for send-now, test and preview), as the calendar day in `EMAIL_MASTHEAD_TIME_ZONE` (Pacific), since no campaign or office stores a time zone and a UTC day would date an evening Pacific send tomorrow. Then the optional photo full width (or after the text when it is at the bottom), left-aligned 17/28 reading text, any other heading as a level 2 subheading in the theme's `subheading` color (else `rule`), dividers and a smaller `cta` button.
- **`personal_letter`**: a plain email on a white page (`card`, not the theme tint), no header or banner. Paragraphs, headings and dividers where they are, the button outlined in the theme's `cta` color on the page color, and the photo padded and centered at 78% of the column, wherever it is.
- **`photo_letter`**: the fixed letter (photo, headline, text, photo, text, button, signature), which the contracts schema already holds to that order, so the layout draws blocks as given. White card on the theme's `bg` tint, 48px gutters, and only the container spaces the parts (32px), so parts carry no outer margin (`EmailParagraph flush`). Photos fill the 504px column with 8px corners (the client crops them 3:2); the headline is 24px semibold (600); text is 16/26; the button is filled with `cta`, white 16px semibold text, centered. The signature is an optional image (48px tall), the name (16px semibold), the office line for line (14px), then, when `profileUrl` is set (gp-api sets it to the owner's live public profile, `services/outreachEmailProfile.service.ts`, before every render), the GoodParty heart (`EMAIL_GOODPARTY_LOGO_URL`) and "My public profile" in `cta` at 12px. A signature with no name, office or image draws nothing. The footer is the shared one.

## Rules

- **Template variables are `{{first_name}}`, `{{last_name}}` and `{{unsubscribe_url}}`.** The first two come from user text; the unsubscribe link is the footer's own placeholder and is filled per recipient at send time. The schema rejects any other `{{tag}}`; any brace that still reaches the renderer (a single `{`, `{{{first_name}}}`, the sender name) is escaped (`&#123;` in html, a zero-width space in text, placed before a `}` so a merge tag never reads as `}}}`, `%7B` in a URL), because SES templates are Handlebars.
- **What is sent is checked against `EmailContentSchema` first** (`util/emailContent.util.ts` `sendableContentOf`, at confirm, test send and prepare). This renderer only enforces the draft schema, so a preview can show an unfinished draft; a button without its link yet points to `#`.
- **Every block carries a solid `bgcolor` attribute plus a CSS background,** and the head declares `color-scheme: light only`. Every class a block uses has its light color repeated in `darkModeCss`. Don't drop either when adding a block; dark-mode clients recolor anything without them.
- **Phones get narrower gutters.** `Block` adds `em-pad` to any block with padding (the shell's page block gets `em-page` instead), and a `max-width:620px` media query in the head cuts `em-pad` to 20px a side and `em-page` to none, so the card runs edge to edge. A new padded block gets this for free; one that sets padding some other way does not. Clients that ignore media queries keep the desktop padding.
- **The footer is system-owned and inside the card.** Win passes `paidForBy` and gets "Paid for by"; Serve passes null and gets no line. The postal address, the reason line and the unsubscribe link are always there. The reason line uses no Win or Serve nouns, so it needs no mode-keyed copy.
- **A new preset needs a contracts entry (`EMAIL_LAYOUT_PRESETS`) and a case in `LAYOUTS`.** A preset with a `structure` has its block order checked by `checkEmailBlocks`; the others never refuse an order. A new theme is a contracts entry only; never edit a shipped theme key in place. `neutral` (black text, blue links) is the original presets' default theme; `photo_letter` defaults to `cyan`, one of the eight letter colors (`EMAIL_LETTER_THEMES`), which tint only the button and profile link and keep text neutral.
- **The original presets render byte for byte as they did.** Sent emails store only their content, so `renderEmailTemplate.snapshot.test.ts` fails on any change to their output. A shared component change for `photo_letter` goes behind a prop whose default keeps the old output.

## Manual rendering pass

`scripts/send-all-email-templates.ts` sends each layout's Win or Serve example in every theme to team inboxes through dev SES (`npx tsx scripts/send-all-email-templates.ts --confirm-dev --to you@goodparty.org`, from a dev AWS session). Run it after any layout or theme change and look at the results in Gmail, Outlook and Apple Mail, light and dark. The dev gallery (`gp-webapp` `/dev/email-templates`) shows the same examples through the preview endpoint.

## Gotchas

- These are `.tsx` files. `tsconfig.json` sets `jsx: react-jsx`, and the `.swcrc` plus `nest-cli.json`'s `extensions` make `nest build` compile them. Without those, `.tsx` files silently stay out of `dist`.
- `React` text children split into separate nodes with `<!-- -->` comments; build a footer or masthead line as one template string if a test or client must match it.
- The example images (`EMAIL_SAMPLE_IMAGE_URLS`) and the signature's GoodParty heart (`goodparty-heart.png`, a PNG because Gmail and Outlook drop SVG) are files in `gp-webapp/public/images/email-samples/`, served from `app.goodparty.org`. `assertEmailImageUrl` accepts exactly the samples besides an organization's own uploads, for image blocks and a signature's `imageUrl`.
