# Email templates

`renderEmailTemplate(layoutKey, themeKey, content)` turns a layout, a theme and the compose fields into `{ html, text, subject }` for an SES template. Layout and theme keys come from `EMAIL_LAYOUTS` and `EMAIL_THEMES` in `@goodparty_org/contracts`. Design: TDD subproblem 3 ("Templates", "Footer"), ClickUp doc `2ky4jq2q-20493`.

## Key files

| Path                         | Purpose                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `renderEmailTemplate.tsx`    | The one entry point. Validates content, protects user text, renders html and plain text               |
| `layouts/*.tsx`              | `newsletter`, `reminder`, `call_to_action`; each takes `{ colors, content }`                          |
| `components.tsx`             | Shared blocks: shell, header with rule line, headline, paragraphs, button, footer                     |
| `emailVariables.util.ts`     | Keeps `{{first_name}}` and `{{last_name}}` as variables and escapes every other brace                 |
| `emailTemplate.const.ts`     | The postal address and the three template variable names                                              |
| `emailThemeContrast.test.ts` | WCAG AA check over every text-on-background pair; `KNOWN_FAILURES` lists palette gaps no layout draws |

## Rules

- **Template variables are `{{first_name}}`, `{{last_name}}` and `{{unsubscribe_url}}`.** The first two come from user text; the unsubscribe link is the footer's own placeholder and is filled per recipient at send time. Any other `{{` in user text is escaped (`&#123;` in html, a zero-width space in text, `%7B` in a URL), because SES templates are Handlebars.
- **Every block carries a solid `bgcolor` attribute plus a CSS background,** and the head declares `color-scheme: light only`. Don't drop either when adding a block; dark-mode clients recolor anything without them.
- **Every layout opens with `EmailHeader`,** which draws the rule line under the header. `cream_and_forest` has a white header, so the rule is what separates it from the card.
- **The footer is inside the card.** Win passes `paidForBy` and gets "Paid for by"; Serve passes null and gets no line. The postal address and the reason line are always there. The reason line uses no Win or Serve nouns, so it needs no mode-keyed copy.
- **A new layout needs a registry entry in contracts and a case in `LAYOUT_COMPONENTS`.** A new theme is a contracts entry only; never edit a shipped theme key in place.

## Manual rendering pass

`scripts/send-all-email-templates.ts` sends every layout and theme to team inboxes through dev SES (`npx tsx scripts/send-all-email-templates.ts --confirm-dev --to you@goodparty.org`, from a dev AWS session). Run it after any layout or theme change and look at the results in Gmail, Outlook and Apple Mail, light and dark.

## Gotchas

- These are `.tsx` files. `tsconfig.json` sets `jsx: react-jsx`, and the `.swcrc` plus `nest-cli.json`'s `extensions` make `nest build` compile them. Without those, `.tsx` files silently stay out of `dist`.
- `React` text children split into separate nodes with `<!-- -->` comments; build a footer line as one template string if a test or client must match it.
