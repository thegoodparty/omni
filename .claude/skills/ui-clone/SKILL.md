---
name: ui-clone
description: Pixel-perfect UI reverse engineering. Accepts a Figma URL and/or a live URL (Lovable, staging, etc.). When a Figma URL is provided, extracts exact design tokens, component specs, and reference code from the Figma MCP — the authoritative source. Falls back to Playwright extraction for live-only URLs. Produces a spec precise enough to implement in one pass, maps everything to the gp-webapp styleguide, and gates on user approval before adding any shadcn components.
argument-hint: <figma-url> [live-url]
allowed-tools: Bash Read Write mcp__claude_ai_Figma__get_design_context mcp__claude_ai_Figma__get_variable_defs mcp__claude_ai_Figma__get_metadata mcp__claude_ai_Figma__get_screenshot
---

Reverse-engineer the UI at $ARGUMENTS into a pixel-perfect implementation spec, using the gp-webapp styleguide patterns throughout.

Parse $ARGUMENTS: it may be one or two URLs separated by a space.
- A `figma.com` URL → use the Figma MCP tools as the **primary source** (Steps 2A–2B)
- A non-Figma URL (Lovable, staging, etc.) → use Playwright extraction (Steps 2C–2D)
- Both → use Figma as primary, Playwright as supplement for live behavior and navigation

The goal is to produce output detailed enough that a developer can implement it **in one pass** — no back-and-forth asking "what color is that?" or "is it a card or a div?".

---

## Codebase context

The target codebase is **gp-webapp** (`packages/gp-webapp` in the omni monorepo).

**Styleguide** is its own package at `packages/styleguide/src/components/ui/`, consumed via the `@styleguide` alias. It is a **latest shadcn/ui** base, with components added incrementally as they are needed — sourced from the Figma design system. Do NOT assume a component exists just because it's in shadcn — check the actual files.

**Shared components** live at `packages/gp-webapp/app/shared/` and are imported via `@shared/*`.

**Brand tokens** are Tailwind classes like `bg-brand-midnight-700`, `text-brand-halo-green-700`, `bg-brand-bright-yellow-50`.

**Figma → Tailwind token mapping** (these are equivalent):

| Figma variable name | Tailwind class prefix |
|---|---|
| `midnight/50` … `midnight/900` | `brand-midnight-50` … `brand-midnight-900` |
| `halo green/50` … `halo green/900` | `brand-halo-green-50` … `brand-halo-green-900` |
| `bright yellow/50` … `bright yellow/900` | `brand-bright-yellow-50` … `brand-bright-yellow-900` |
| `waxflower/50` … `waxflower/900` | `brand-waxflower-50` … `brand-waxflower-900` |

When Figma reference code uses `bg-[var(--midnight/50,#ecf5ff)]`, translate it to `bg-brand-midnight-50`. When it uses `text-[var(--halo-green/700,#...)]`, translate to `text-brand-halo-green-700`.

Before writing any spec, read the styleguide index to know what's already available:
```bash
cat packages/styleguide/src/components/ui/index.ts
ls packages/styleguide/src/components/ui/
ls packages/gp-webapp/app/shared/
```

---

## What this skill produces

For every view discovered:
- Exact HTML structure (tag hierarchy)
- Exact Tailwind class strings (translated to brand token classes, not raw CSS variable strings)
- All color tokens with their gp-webapp equivalents
- Screenshots at every scroll position and navigation step, **at every breakpoint** (desktop, tablet, mobile)
- Component breakdown: what each piece is, what data it needs, what it does on interaction
- **Responsive behavior**: per-breakpoint layout differences (stacking, hidden elements, font/spacing changes, nav transformations)
- **Styleguide mapping**: which existing `@styleguide` or `@shared` component to use for each element
- **Gap list**: any shadcn components needed that aren't yet in the styleguide

## Breakpoints

Capture at these three widths. They match gp-webapp's Tailwind defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280):

| Label | Width × Height | Maps to Tailwind |
|---|---|---|
| `desktop` | 1280 × 900 | `lg:` / `xl:` |
| `tablet` | 768 × 1024 | `md:` |
| `mobile` | 390 × 844 | base (no prefix) — iPhone 14 size |

Default behavior: capture **all three**. If the user has explicitly said the design is desktop-only or mobile-only, skip the others.

---

## Step 1 — Plan

Parse $ARGUMENTS and determine:
1. Is a Figma URL present? → use Figma MCP (Steps 2A–2B)
2. Is a live URL present? → use Playwright (Steps 2C–2D)
3. How many distinct views exist? (list → detail → sub-detail, etc.)
4. What are the key components to extract?

---

## Step 2A — Figma MCP extraction (when Figma URL is provided)

Parse the Figma URL to extract `fileKey` and `nodeId`:
- `figma.com/design/:fileKey/:fileName?node-id=:nodeId` → URL-decode the nodeId first (Figma often percent-encodes it, e.g. `123%3A456`, so replace `%3A` with `:`), then convert any remaining `-` to `:` (e.g. `123-456` → `123:456`). The Figma MCP expects the `:` form (`123:456`); passing `%3A` or `-` fails silently or fetches the wrong node.

Call these tools **in this order**:

### 1. Get metadata (understand the file structure)
Call `mcp__claude_ai_Figma__get_metadata` with the fileKey. This reveals the page/frame hierarchy — use it to find which frames contain each view.

### 2. Get variable definitions (the design token source of truth)
Call `mcp__claude_ai_Figma__get_variable_defs` with the fileKey. This returns every color token with its exact hex value — the canonical palette. Map each token to its Tailwind brand class equivalent.

### 3. Get design context for each view (the main extraction)
Call `mcp__claude_ai_Figma__get_design_context` with the fileKey and nodeId. Do this for:
- The primary node from the URL
- Any sibling frames that represent other views (detail, sub-detail, etc.) — find their IDs from the metadata
- **Mobile/tablet variants of each view** — designers commonly name these "Mobile / [View]", "[View] - Mobile", "[View] (sm)", or place them on a separate page. Scan the metadata for these. If only a desktop frame exists, note it explicitly in the spec ("no mobile frame in Figma — responsive behavior inferred").

**What the design context returns:**
- Reference React+Tailwind code — treat this as the most authoritative source for component structure and class strings
- Screenshot of the frame — read it carefully
- Component hints linking to shadcn docs
- CSS variable usage like `bg-[var(--midnight/50,#ecf5ff)]`

**How to use the reference code:**
- It is a reference, not final code — adapt to gp-webapp conventions
- Translate all `bg-[var(--token/shade,#hex)]` patterns to `bg-brand-{token}-{shade}` Tailwind classes
- Note every class string verbatim before translating — record both the original and the translation

### 4. Get screenshots for visual confirmation
Call `mcp__claude_ai_Figma__get_screenshot` for each frame to get a visual of the design.

---

## Step 2B — Figma color token extraction

After getting variable defs, produce a complete token table:

```
Figma token          Hex value    Tailwind class
midnight/50          #ecf5ff      brand-midnight-50
midnight/100         #...         brand-midnight-100
...
halo green/50        #ddf2e8      brand-halo-green-50
...
waxflower/50         #ffebd8      brand-waxflower-50
...
bright yellow/50     #fffadf      brand-bright-yellow-50
...
```

This table must appear in the spec. It is the single source of truth for all color decisions.

---

## Step 2C — Playwright extraction (when live URL is provided, no Figma)

Write the script to your session scratchpad directory (or any unique path) — not a shared `/tmp/ui_clone.py`, since concurrent agents share the host filesystem. The script itself writes all screenshots and the results JSON to a unique `mkdtemp` dir it prints at the end. This is **only needed when there is no Figma URL**, or as a supplement to capture live navigation behavior.

**Scope check first.** This skill is built for one or two views and their interactive states. If the target is a deep multi-page tree (5+ unique pages, nested nav, broad SPA surface), prefer the `playwright-explore` skill for the structural pass, then come back to `ui-clone` for the specific views you'll implement. Don't try to crawl an entire app inside `ui-clone`.

### What this script captures per breakpoint

1. **Initial landing view** (scroll-by-scroll)
2. **Interactive states** — for each view, the script auto-expands and re-captures:
   - Accordions / collapsibles (`[data-state=closed]`, `details:not([open])`, `[aria-expanded=false]`, `button[class*=accordion]`)
   - Tabs (`[role=tab]` — capture each panel)
   - Mobile menu / hamburger (`button[aria-label*=menu i]`, `[aria-controls*=nav i]`)
   - Modals/dialogs triggered by visible primary CTAs
3. **Sub-page navigation** — fills in `nav_attempts` to follow links/buttons into N additional views. Each sub-view repeats steps 1–2.

### Iteration loop (important)

The first run captures landing + auto-expanded states. **Read the output, then fill in `nav_attempts` with real selectors from `interactive_elements`** and re-run. Repeat until every view the user will implement has been captured. Each run writes a complete capture to its own printed `OUT_DIR` (`ui_clone_results.json` plus the screenshots) — read the latest run's dir; earlier runs are left intact.

For very nested flows (wizard step 1 → 2 → 3 → confirmation), add each step as a separate entry in `nav_attempts` with the prior selector chain — or split into separate script files per flow.

```python
import asyncio, json, os, tempfile
from pathlib import Path
from playwright.async_api import async_playwright

START_URL = "REPLACE_WITH_URL"
# Unique per-run output dir so concurrent agents on the same host (worktrees
# share the filesystem, per CLAUDE.md) never collide on screenshots or the
# results JSON. Printed at the end so you know where the artifacts landed.
OUT_DIR = tempfile.mkdtemp(prefix="ui_clone_")
# Set to ["desktop"] or ["mobile"] to skip breakpoints if user has said design is single-target
BREAKPOINTS = [
    ("desktop", 1280, 900),
    ("tablet", 768, 1024),
    ("mobile", 390, 844),
]
results = {"url": START_URL, "out_dir": OUT_DIR, "breakpoints": {}}
shot_num = 0

async def snap(page, label):
    global shot_num
    path = os.path.join(OUT_DIR, f"ui_clone_{shot_num:02d}_{label}.png")
    await page.screenshot(path=path, full_page=False)  # viewport only — for scroll-by-scroll
    print(f"  [{shot_num:02d}] {label}")
    shot_num += 1
    return path

async def extract_tokens(page):
    """Extract CSS custom properties from :root — the design tokens.
    Cross-origin stylesheets (CDN CSS, common on Lovable/staging) can't be read
    via `cssRules` and throw a SecurityError. We COUNT those instead of swallowing
    silently, so an empty/thin token set is legible: if crossOriginSheetsSkipped
    is high, tokens are incomplete — fall back to computed styles (component_specs)
    or the Figma variable defs."""
    return await page.evaluate("""() => {
        const tokens = {}
        let crossOriginSheetsSkipped = 0
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    if (rule.selectorText === ':root') {
                        const matches = rule.cssText.matchAll(/--([\\w-]+):\\s*([^;]+)/g)
                        for (const m of matches) {
                            tokens[m[1]] = m[2].trim()
                        }
                    }
                }
            } catch(e) { crossOriginSheetsSkipped++ }
        }
        return { tokens, crossOriginSheetsSkipped }
    }""")

async def expand_all_collapsibles(page, label):
    """Click every visible accordion/collapsible/details trigger so closed content is captured.
    Returns a list of screenshots taken after each batch of expansions."""
    shots = []
    selectors = [
        "[data-state='closed']",         # Radix
        "details:not([open]) > summary", # native
        # generic ARIA, but NOT the hamburger/nav toggle — capture_mobile_menu
        # owns that, and clicking it here would toggle the menu shut again.
        "[aria-expanded='false']:not([aria-controls*='nav' i]):not([aria-label*='menu' i])",
        "button[class*='accordion' i]",  # heuristic
        "button[class*='collapsible' i]",
    ]
    for sel in selectors:
        try:
            handles = await page.query_selector_all(sel)
            clicked = 0
            for h in handles[:20]:  # safety cap
                try:
                    if await h.is_visible():
                        await h.scroll_into_view_if_needed(timeout=1000)
                        await h.click(timeout=1500)
                        clicked += 1
                        await page.wait_for_timeout(200)
                except Exception:
                    pass
            if clicked:
                shots.append(await snap(page, f"{label}_expanded_{sel.replace(' ', '_')[:30]}"))
        except Exception:
            pass
    return shots

async def capture_tab_states(page, label):
    """Click each [role=tab] in turn and snapshot the resulting panel."""
    shots = []
    try:
        tab_count = await page.locator("[role='tab']").count()
        for i in range(min(tab_count, 10)):
            try:
                tab = page.locator("[role='tab']").nth(i)
                if await tab.is_visible():
                    text = (await tab.text_content() or f"tab{i}").strip()[:20].replace(" ", "_")
                    await tab.click(timeout=1500)
                    await page.wait_for_timeout(400)
                    shots.append(await snap(page, f"{label}_tab_{text}"))
            except Exception:
                pass
    except Exception:
        pass
    return shots

async def capture_mobile_menu(page, label):
    """On mobile widths, open the hamburger / nav drawer if one exists."""
    shots = []
    candidate_selectors = [
        "button[aria-label*='menu' i]",
        "button[aria-label*='navigation' i]",
        "button[aria-controls*='nav' i]",
        "[data-testid*='hamburger' i]",
        "button:has(svg[class*='menu' i])",
    ]
    for sel in candidate_selectors:
        try:
            btn = page.locator(sel).first
            if await btn.count() > 0 and await btn.is_visible():
                await btn.click(timeout=1500)
                await page.wait_for_timeout(500)
                shots.append(await snap(page, f"{label}_mobile_menu_open"))
                return shots  # one menu is enough
        except Exception:
            pass
    return shots

async def extract_view(page, label, viewport_height):
    """Full extraction of the current view — structure, classes, styles, text."""

    # 1. Scroll viewport-by-viewport and capture screenshots
    scroll_height = await page.evaluate("() => document.body.scrollHeight")
    scroll_positions = list(range(0, scroll_height, viewport_height))
    shots = []
    for pos in scroll_positions:
        await page.evaluate(f"window.scrollTo(0, {pos})")
        await page.wait_for_timeout(400)
        path = await snap(page, f"{label}_scroll{pos}")
        shots.append(path)
    await page.evaluate("window.scrollTo(0, 0)")

    # 2. Extract all interactive elements (both links AND buttons)
    interactive = await page.evaluate("""() =>
        Array.from(document.querySelectorAll('a[href], button, [role=button], [role=link]'))
        .map(el => ({
            tag: el.tagName,
            text: el.textContent.trim().slice(0, 80),
            href: el.getAttribute('href') || '',
            classes: el.className.slice(0, 200),
            type: el.type || ''
        })).filter(el => el.text).slice(0, 60)
    """)

    # 3. Extract full inner HTML of main content (the real treasure for Tailwind
    # classes). Capped at 15k chars, but flagged when clipped so you know the
    # class strings are incomplete (routine for a Tailwind-heavy SPA) and can
    # re-extract a narrower selector rather than trust a partial capture.
    main_html = await page.evaluate("""() => {
        const main = document.querySelector('main,[role=main],[class*=content],[class*=Content]')
            || document.body
        const full = main.innerHTML
        return { html: full.slice(0, 15000), truncated: full.length > 15000 }
    }""")

    # 4. Extract key component specs — exact classes + computed styles
    component_specs = await page.evaluate("""() => {
        const specs = {}

        function specOf(selector, name) {
            const el = document.querySelector(selector)
            if (!el) return null
            const cs = getComputedStyle(el)
            return {
                tag: el.tagName,
                classes: el.className,
                inline_style: el.getAttribute('style') || '',
                text: el.textContent.trim().slice(0, 120),
                computed: {
                    bg: cs.backgroundColor,
                    color: cs.color,
                    border: cs.border,
                    borderRadius: cs.borderRadius,
                    padding: cs.padding,
                    fontSize: cs.fontSize,
                    fontWeight: cs.fontWeight,
                }
            }
        }

        function specsOf(selector, name) {
            return Array.from(document.querySelectorAll(selector)).slice(0, 6).map(el => {
                const cs = getComputedStyle(el)
                return {
                    tag: el.tagName,
                    classes: el.className,
                    inline_style: el.getAttribute('style') || '',
                    text: el.textContent.trim().slice(0, 120),
                    computed: {
                        bg: cs.backgroundColor,
                        color: cs.color,
                        border: cs.border,
                        borderRadius: cs.borderRadius,
                        padding: cs.padding,
                    }
                }
            })
        }

        specs.layout = specOf('[class*=flex][class*=col],[class*=flex-col]', 'layout')
        specs.cards = specsOf('[class*=card],[class*=Card],[class*=rounded-3xl],[class*=rounded-xl]', 'cards')
        specs.badges = specsOf('[class*=badge],[class*=Badge],[class*=chip],[class*=rounded-full][class*=px]', 'badges')
        specs.buttons = specsOf('button', 'buttons')
        specs.callouts = specsOf('[class*=border-l],[style*=border-left]', 'callouts')
        specs.headings = specsOf('h1,h2,h3,h4', 'headings')
        specs.sticky = specsOf('[class*=sticky],[class*=fixed]', 'sticky')
        specs.inline_styled = Array.from(document.querySelectorAll('[style]'))
            .slice(0, 20)
            .map(el => ({
                tag: el.tagName,
                classes: el.className.slice(0, 100),
                style: el.getAttribute('style'),
                text: el.textContent.trim().slice(0, 60)
            }))

        return specs
    }""")

    page_text = await page.evaluate("() => document.body.innerText.slice(0, 3000)")

    # 5. Interactive states — expand collapsibles, walk tabs, open mobile menu.
    # These mutate the page; run them AFTER the structural capture above so the
    # default-state HTML is what gets recorded in main_html.
    viewport = page.viewport_size or {"width": 0}
    interaction_shots = []
    interaction_shots += await expand_all_collapsibles(page, label)
    interaction_shots += await capture_tab_states(page, label)
    if viewport.get("width", 0) < 768:
        interaction_shots += await capture_mobile_menu(page, label)

    return {
        "label": label,
        "url": page.url,
        "screenshots": shots,
        "interaction_screenshots": interaction_shots,
        "interactive_elements": interactive,
        "main_html": main_html["html"],
        "main_html_truncated": main_html["truncated"],
        "component_specs": component_specs,
        "page_text": page_text,
    }

async def run_breakpoint(pw, bp_label, width, height):
    """Run the full extraction at one breakpoint."""
    print(f"\n=== Breakpoint: {bp_label} ({width}x{height}) ===")
    browser = await pw.chromium.launch(headless=True)
    # Mobile breakpoint uses a touch-capable context so responsive code paths trigger correctly.
    is_mobile = width < 768
    ctx = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            if is_mobile else
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        viewport={"width": width, "height": height},
        device_scale_factor=2 if is_mobile else 1,
        is_mobile=is_mobile,
        has_touch=is_mobile,
    )
    page = await ctx.new_page()

    try:
        await page.goto(START_URL, wait_until="networkidle", timeout=25000)
    except Exception:
        await page.goto(START_URL, wait_until="domcontentloaded", timeout=20000)
    await page.wait_for_timeout(3000)

    bp_data = {"viewport": {"width": width, "height": height}, "css_tokens": {}, "views": []}
    token_result = await extract_tokens(page)
    bp_data["css_tokens"] = token_result["tokens"]
    bp_data["css_tokens_cross_origin_skipped"] = token_result["crossOriginSheetsSkipped"]

    view1 = await extract_view(page, f"{bp_label}_view1_landing", height)
    bp_data["views"].append(view1)

    # ── NAVIGATE TO NEXT VIEW ─────────────────────────────────────
    # Fill in nav_attempts based on what view1["interactive_elements"] shows.
    # SPAs often navigate via button onClick, not <a href>. Check both.
    # NOTE: mobile nav may be behind a hamburger — selectors may differ from desktop.
    nav_attempts = [
        # Examples:
        #   ("button:has-text('Read the full briefing')", "issue_detail"),
        #   ("a[href*='/detail']", "detail_link"),
        # Mobile-specific (open menu first if needed):
        #   ("button[aria-label='Open menu']", "mobile_menu_open"),
    ]

    # Follow EVERY nav_attempt in order, returning to the start page between each
    # so each sub-page is captured from a clean state (not from a deep-link chain).
    for i, (selector, sub_label) in enumerate(nav_attempts):
        try:
            await page.goto(START_URL, wait_until="networkidle", timeout=20000)
            await page.wait_for_timeout(1500)
            el = page.locator(selector).first
            if await el.count() == 0:
                print(f"  Nav {sub_label}: selector {selector} not found")
                continue
            await el.scroll_into_view_if_needed(timeout=2000)
            await el.click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(2000)
            sub_view = await extract_view(page, f"{bp_label}_view{i+2}_{sub_label}", height)
            bp_data["views"].append(sub_view)
        except Exception as e:
            print(f"  Nav attempt {selector} failed: {e}")

    await browser.close()
    return bp_data

async def main():
    async with async_playwright() as pw:
        for bp_label, width, height in BREAKPOINTS:
            results["breakpoints"][bp_label] = await run_breakpoint(pw, bp_label, width, height)

        results_path = os.path.join(OUT_DIR, "ui_clone_results.json")
        Path(results_path).write_text(json.dumps(results, indent=2, default=str))
        print(f"\nExtraction complete. Artifacts in {OUT_DIR}")
        print(f"  results: {results_path}")
        for bp_label, bp_data in results["breakpoints"].items():
            skipped = bp_data.get("css_tokens_cross_origin_skipped", 0)
            print(f"  [{bp_label}] tokens={len(bp_data['css_tokens'])} (cross-origin sheets skipped: {skipped}) views={len(bp_data['views'])}")
            for v in bp_data["views"]:
                print(f"    {v['label']}: {v['url']} ({len(v['screenshots'])} scroll shots)")

asyncio.run(main())
```

**IMPORTANT**: After the first run, read each breakpoint's `views[0]["interactive_elements"]` and fill in real `nav_attempts` selectors. Re-run to capture deeper views. Note that mobile selectors may differ from desktop — a nav link on desktop might live inside the hamburger menu on mobile, requiring a chained click (the script's `capture_mobile_menu` opens the menu before scrolling, but linked items may still need their own `nav_attempts` entries).

Run it (from wherever you wrote it, e.g. your scratchpad dir):
```bash
uv run python <scratchpad>/ui_clone.py
```

If playwright missing: `uv add playwright && uv run playwright install chromium`

---

## Step 2D — Read Playwright output

Read ALL screenshots in numbered order, **grouped by breakpoint**. Compare desktop vs mobile shots for the same view to spot:
- Which elements stack vertically on mobile vs sit side-by-side on desktop
- Which elements are hidden on mobile (e.g. secondary nav, side rails)
- Font-size and spacing differences
- Whether the nav becomes a hamburger
- Card/grid → list transformations

Then read the `ui_clone_results.json` in the `OUT_DIR` the script printed. The shape is `results.breakpoints[bp_label].views[]`. Focus on:
- `css_tokens` — `:root` design tokens (should be identical across breakpoints; flag if not). If `css_tokens_cross_origin_skipped` is high, the token set is incomplete (CDN CSS) — lean on `component_specs` / Figma variable defs instead.
- Each view's `main_html` — **most important**: exact Tailwind class strings (responsive prefixes like `md:flex-row` live here). Check `main_html_truncated`: if `true`, the capture was clipped at 15k chars — re-extract with a narrower selector before trusting the class strings.
- Each view's `component_specs.inline_styled` — `style=` attributes reveal CSS token usage
- Each view's `component_specs.callouts` — left-border colored boxes
- Each view's `component_specs.buttons` — exact button classes
- Each view's `interaction_screenshots` — accordion-open, per-tab, mobile-menu-open states

Diff the `main_html` between desktop and mobile for the same view. Differences are usually one of: responsive Tailwind prefixes (`hidden md:block`, `flex-col md:flex-row`), or entirely separate components rendered conditionally. The spec must call out which.

---

## Step 3 — Synthesize into pixel-perfect spec

Combine everything (Figma context + variable defs + screenshots + Playwright HTML if applicable).

**Priority order for authoritative class strings:**
1. Figma `get_design_context` reference code (most authoritative — from Figma source)
2. Playwright `main_html` (second — from live render)
3. Computed styles from Playwright (last resort — lossy)

Write a spec covering **every view** discovered. For each view include:

### Layout
- Exact wrapper classes (e.g. `flex flex-col min-h-full`)
- Background color (e.g. `bg-muted`)
- Max-width and centering (e.g. `max-w-[680px] mx-auto` or `style={{ width: 680, maxWidth: '100%' }}`)
- Sticky/fixed elements and their exact classes

### Components — for each distinct component:
```
Component: <name>
Tag: <div|button|section|etc>
Classes: <exact tailwind string — brand token classes, NOT CSS variable syntax>
Inline style: <exact style="" value if any (only for non-tokenizable values)>
Color tokens used: <list brand-* classes → what they map to in hex>
Content: <what text/children it contains>
Interaction: <what happens on click/hover, what state is local vs from props>
```

### Color palette
```
Figma token      →  Tailwind class             →  Hex      →  Used for
midnight/50      →  bg-brand-midnight-50       →  #ecf5ff  →  issue 1 callout bg
midnight/700     →  text-brand-midnight-700    →  #...     →  issue 1 badge, labels
...
```

### Color cycling pattern (if present)
If the design cycles colors across repeated items, document the full cycle array with exact classes for each slot:
```
Issue 1 (index 0): badge=bg-brand-midnight-700, text=text-brand-midnight-700, border=border-l-brand-midnight-300, bg=bg-brand-midnight-50
Issue 2 (index 1): badge=bg-brand-halo-green-700, ...
Issue 3 (index 2): badge=bg-brand-waxflower-700, ...
Issue 4+ (index 3): badge=bg-violet-700, ...
```

### Routes / navigation map
```
/path → View name → how to get there → what triggers navigation back
```

### Responsive behavior (REQUIRED — one section per view)

For each view, document the per-breakpoint differences. Use the gp-webapp Tailwind defaults: base = mobile (<768), `md:` = tablet (≥768), `lg:` = desktop (≥1024).

```
View: <name>

Layout:
  mobile  → single column, full-width cards, sticky bottom CTA
  tablet  → same as mobile but max-w-[680px] mx-auto
  desktop → two-column (sidebar 280px + main), no sticky CTA

Nav:
  mobile  → hamburger button reveals drawer with links
  desktop → horizontal link bar in header

Hidden elements:
  hidden on mobile: ".secondary-rail" (use `hidden md:block`)
  hidden on desktop: ".back-button-top" (use `md:hidden`)

Typography deltas:
  h1: text-2xl on mobile → text-4xl on desktop
  card title: text-base on mobile → text-lg on desktop

Spacing deltas:
  section py: py-6 mobile → py-12 desktop
  container px: px-4 mobile → px-8 desktop

Component swaps (not just CSS):
  Carousel on mobile → 3-column grid on desktop (different components, conditional render or CSS)
```

**If a difference can be expressed with Tailwind responsive prefixes, write the exact prefix-chained class string** (e.g. `flex flex-col gap-4 md:flex-row md:gap-8`). **If it requires a different component entirely**, say so and flag it for implementation as a conditional render.

### Implementation notes
- Non-obvious structures: items that look like one component but are a wrapper containing N children
- Color cycling patterns and their implementation (const array, indexed by position)
- Sticky positioning that requires special layout handling (e.g. `wrapperClassName="!p-0"` on DashboardLayout)
- What state is local (accordion open/close, thumbs feedback) vs what comes from props/API

---

## Step 4 — Map to the gp-webapp styleguide

Read the actual styleguide files:

```bash
ls packages/styleguide/src/components/ui/
cat packages/styleguide/src/components/ui/index.ts
ls packages/gp-webapp/app/shared/
```

For each distinct component in the design, fill in this table:

| Element | Use from styleguide? | Import | Notes |
|---|---|---|---|
| Card container | `Card`, `CardContent` from `@styleguide` | `import { Card, CardContent } from '@styleguide'` | adjust rounding via className |
| Badge/pill | `Badge` from `@styleguide` | `import { Badge } from '@styleguide'` | use `variant="outline"` + color className |
| Button | `Button` from `@styleguide` OR native `<button>` | depends on variant | shadcn Button for standard variants; native for custom pill/rounded-full styles |
| Sticky header | native `<div className="sticky top-0 ...">` | — | no styleguide component needed |
| Left-border callout | native `<div className="border-l-4 ...">` | — | not a shadcn component |
| Collapsible section | Check if `Collapsible` exists in styleguide | `import { Collapsible, ... } from '@styleguide'` | **may need to add** |
| ... | ... | ... | ... |

**For each row**: if the component doesn't exist in the styleguide yet, mark it as **NEEDS ADDING**.

---

## Step 5 — Styleguide gap approval (REQUIRED before implementation)

After the mapping table, produce a **Gap Report**:

```
## Styleguide Gap Report

The following shadcn/ui components are needed but NOT yet in the styleguide:

1. **Collapsible** (`@radix-ui/react-collapsible`)
   - Used for: expandable "Who is presenting" and "Supporting context" sections
   - shadcn install: `npx shadcn@latest add collapsible`
   - Files it would create: `styleguide/components/ui/collapsible.tsx`
   - Alternative without adding: React `useState` toggle — no new dependency

2. **[component name]** (`[package]`)
   - Used for: [what it's for]
   - shadcn install: `npx shadcn@latest add [name]`
   - Alternative without adding: [describe workaround]

## Recommendation

[Either: "All gaps can be handled without adding components — use these alternatives..."
 OR: "Adding X is strongly recommended because Y. The alternatives would be significantly worse because Z."]

## ⚠️ Awaiting your approval

Should I:
A) Add the missing components to the styleguide before implementing?
B) Use the native/workaround alternatives instead?
C) Some combination — add [X] but work around [Y]?
```

**STOP HERE and wait for the user's answer before writing any implementation code.**

Do not proceed to implementation until the user has approved which approach to take for any styleguide gaps. If there are no gaps (all needed components already exist), say so explicitly and proceed.

---

## What NOT to do

- Do not summarise classes. Copy them verbatim — or translate them to exact brand token equivalents. "rounded-3xl border border-border overflow-hidden" is infinitely more useful than "a rounded card".
- Do not leave CSS variable syntax in the spec. `bg-[var(--midnight/50,#ecf5ff)]` must become `bg-brand-midnight-50`.
- Do not guess colors. Use Figma variable defs or computed styles. Say exactly what the hex is.
- Do not skip scroll positions in Playwright. Content below the fold is often the most important part.
- Do not assume navigation uses `<a>` tags. SPAs often use `<button>` with onClick. Check `interactive_elements` carefully.
- Do not add components to the styleguide without explicit user approval. The styleguide is intentional — components are added from Figma, not automatically.
- Do not use a raw `<button>` where a styleguide `Button` would work, and vice versa — check the exact variant needed against what's available.
- Do not use the Figma reference code as-is. It uses generic Tailwind — always adapt to gp-webapp brand token classes and existing patterns.
- Do not skip mobile and tablet capture unless the user has explicitly said the design is desktop-only. Mobile-only designs are also a thing — confirm with the user if the source has only one breakpoint.
- Do not ship a spec without the Responsive behavior section per view. "Responsive" alone is not a spec — it must list exact stacking, hidden elements, typography deltas, and any component swaps with their breakpoint prefixes.
- Do not capture only the default state. Run the script's auto-expand pass and verify the resulting `interaction_screenshots` show accordion-open, per-tab, and (on mobile) menu-open. If the design has modals, wizards, or multi-step flows, add explicit `nav_attempts` entries for them.
- Do not crawl an entire app inside this skill. For deep multi-page exploration, use `playwright-explore` first to map the structure, then return to `ui-clone` for the specific views you'll implement.
