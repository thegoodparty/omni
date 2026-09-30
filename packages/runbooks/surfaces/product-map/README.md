# Product map

The product as the steps and zones a person passes through, with the analytics events
that fire on each one attached where they are known, and the steps where nothing fires
shown as holes. Same facts as the analytics event explorer, organised by the shape of the
product instead of by question. For the same audience: anyone who wants to know whether
we measure something, arriving from their own memory of using the site.

Ticket: DATA-2547, under the DATA-2580 epic. Published page:
`https://claude.ai/artifact/1P4qyB56ZNPJ9VPaMjDLLZ` (republish to the same URL).

## One page with the explorer

The map has no template of its own. `build.py` renders the explorer's
`standalone/template.html` with `DATA.page = 'map'`, so the header, search, product
filters, question and area cards, event card and What's next are the explorer's, and the
only section that differs is the one under the filters: the explorer lists events, the
map draws this tree. The two files here are what the map adds, passed to
`shared/partials.py` as page parts:

- `map.js`: the `ProductMap` module. The node model (`TREE`, one constant per surface),
  the tree renderer, and the Layers / Show controls.
- `map.css`: its styles. Six class names the explorer also uses are renamed here
  (`.fkind`, `.evdot`, `.maplegend`, `.mevname`, `.hole`, `.mnote`) because both
  stylesheets load on one page.

Search and filters pick events exactly as they do on the explorer. The map then keeps
the flows those events are on, plus any step, flow or area whose own name matches, so a
step with nothing firing (`Pick Send Date`) is still found by "send date". A kept flow
opens whole, with the matching events marked and the other steps dimmed, because a step
means little without the steps around it. Matching events on no drawn flow are listed in
a folded "not on the map yet" table below.

## What it is, and what it is not yet

This is the prototype shipped as a first version, on purpose. It was shared to find out
what people can do with it, and the page says so in its "Still being built" panel. What
is real and what is not:

| Real | Not yet |
| --- | --- |
| Six surfaces across Win and Serve, steps read from each flow's own config | Eight more flows, located by file, not drawn |
| Every event opens the shared card: verdict, both names, volume, Amplitude | Per-step volume where one event covers many steps |
| Anchor state on every event: anchored, no anchor, call site unknown, no route | Zones on a page are inferred from `fires_on`, not declared anywhere |
| Feedback composer and usage tracking, the explorer's, from the shared partials | A snapshot-driven builder; the node model is hand-authored in `map.js` |
| Eleven undrawn flows placed under their areas as "Still being built" placeholders | Their steps, read out of the files each placeholder names |

A placeholder is `building(name, route, src, note?)` in the `TREE`. It renders as a
collapsed surface with the tag and opens to the file its steps live in, so the map never
reads as complete. Drawing one means replacing the placeholder with a surface constant.

The node model (`TREE`, the surface constants) lives in `map.js` as code, because
it carries judgement per step: which events belong, which branch rejoins where, what a
note should say. Reading it out of the repo automatically is the DATA-2547 follow-up,
and its refresh mechanism is the one `event_anchors.json` already uses.

## Data

Two inputs, deliberately.

- `data/product-map.json`: the map's own rows. `ev` is `{event_type: [status, count_30d,
  count_total, series, url, description, fires_on, pr, instrumented, last_seen,
  anchor_state, newer_than_snapshot, display_name]}`. Seeded from the 2026-09-24 explorer snapshot plus the 2026-09-28 health run for the
  three events newer than the snapshot. Positional because the prototype was.
- The explorer snapshot, `packages/prototypes/app/p/analytics-event-explorer/data/event-explorer.json`,
  whole, because the page searches every event the explorer does. The cards come from it,
  so the card a person opens here is the card they would open there.

Three events are on the map and not in the explorer snapshot (they postdate it). Their
card says "no catalog entry" and the row carries a "new since snapshot" tag; that is
correct, not a bug.

## Rebuilding and publishing

```bash
cd packages/runbooks/surfaces/product-map && python3 build.py   # -> product-map.html
```

Needs nothing: no uv, no credentials. Then publish `product-map.html` to the URL above,
**omitting `capabilities`** so the page keeps its stored declaration (`db`, `user`
profile scope, `comments` composer only). Passing `capabilities` replaces the whole
declaration and kills tracking and the feedback button.

## Shared with the other two pages

Palette, event card, the nav bar and the usage/feedback script come from `../shared/` and
are inlined by `build.py`. `map.css` aliases its historical variable names (`--paper`,
`--rule`, `--ok`) onto the shared theme, plus one tone the theme does not have: `--drift`,
for two event generations live on one step. Do not restyle the card here; change
`../shared/card.css` and rebuild all three pages.

Its pill buttons are `.pillbtn`, not `.chip`, because `.chip` is the shared card's tone
badge and the two collided.

The map page does not refresh itself (DATA-2582), so a change to the explorer template
reaches it only when it is rebuilt and republished by hand. Rebuild both after touching
the template.

## Things that will surprise you

- **Anchors alone draw false holes.** `Signup Goal Viewed` and `Manual Office Viewed` are
  both active with no anchor record. The map uses the registry for existence and anchors
  only for the route, which is why those steps show as "no anchor" rather than empty.
- **One event can cover many steps.** The SMS wizard fires `Voter Outreach - Flow Step
  Viewed/Completed` for every step with `step` as a property. Matching by event name
  would call all five steps uninstrumented; the map attaches `(event, property value)`
  and says the volume is per event, not per step.
- **Route comparison is by first path segment.** Whole-string comparison flagged
  `/onboarding` against `/onboarding/[slug]/[step]` on 6 of 10 onboarding nodes.
- **Relabel, never rename.** The card shows both names always; the row shows the type
  only where it differs from the label (4 of 593 events). The relabel panel on Poll
  onboarding proposes display-name changes only.
