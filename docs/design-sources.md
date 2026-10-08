# Design sources

> **Draft, under review,** alongside `product-design.md`. Send feedback to
> Justin.

Where to look when a design question isn't answered by `product-design.md`.
Start with tier 1. Other sources are allowed, but say where a claim came from and
why it's worth trusting, so a person can judge it.

## Our own evidence comes first

What our users actually do outranks every source below.

- **Amplitude.** Funnels, drop-off, return rates, device split. Event names are
  in the project's taxonomy, and most carry a description of where they fire.
- **User interviews and support conversations.** Read them yourself; an AI
  summary is not the insight.

## Tier 1: start here

**UX research**

- Nielsen Norman Group: https://www.nngroup.com/articles/
- Baymard Institute (forms, checkout, e-commerce UX): https://baymard.com/blog

**Design systems**

- GOV.UK Design System (forms, errors, confirmation pages, plain language):
  https://design-system.service.gov.uk/
- US Web Design System (civic services, closest to our users):
  https://designsystem.digital.gov/
- Material Design: https://m3.material.io/
- Apple Human Interface Guidelines:
  https://developer.apple.com/design/human-interface-guidelines/
- Shopify Polaris: https://polaris-react.shopify.com/
- Atlassian Design System: https://atlassian.design/
- IBM Carbon: https://carbondesignsystem.com/
- GitHub Primer: https://primer.style/
- Microsoft Fluent 2: https://fluent2.microsoft.design/

**Accessibility**

- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- ARIA Authoring Practices Guide (how each widget should behave):
  https://www.w3.org/WAI/ARIA/apg/

**Civic tech practice**

- Code for America: https://codeforamerica.org/

## Tier 2: how to build it, not what to build

- shadcn/ui: https://ui.shadcn.com/docs
- Radix Primitives: https://www.radix-ui.com/primitives/docs
- vaul (our drawers; its author marks it unmaintained):
  https://github.com/emilkowalski/vaul

## Avoid

- SEO roundups ("the best X in 2026", "complete guide").
- Vendor pages that are really ads for a tool.
- Anything that reads as AI-generated.
- A single blog post presented as consensus. When sources disagree, say so and
  name each one.

## When sources disagree

They often do. Examples we've hit: stacking drawers (Primer allows two levels,
Apple and Atlassian say never), and marking form fields (GOV.UK marks only
optional fields, Nielsen Norman Group marks every required field, Baymard marks
both). Report the disagreement and any data behind each side; don't pick one
silently.
