// Serve vocabulary gate. Fails when Serve copy says a Win-only word.
//
// Serve users are elected officials. They have constituents, an office and a
// term. They do not have voters, an election, a candidacy or a ballot, and
// "campaign" in the run-for-office sense is not theirs either. The full rule,
// including the two senses of "campaign", is `docs/product-vocabulary.md` —
// read that before changing anything here.
//
// This module is the shared logic behind all three enforcement layers:
//   - `serveVocabulary.test.ts`   — the Vitest gate CI fails on
//   - `check-serve-vocabulary.ts` — the CLI the Claude PostToolUse hook runs
// One implementation, so the hook and the gate can never disagree about what
// passes.
//
// WHAT IT LOOKS AT is the interesting part. A file Serve merely *reaches* is
// no good as the unit: `outreach/v2/` is mounted by both surfaces, so it is
// full of Win copy that must not change. So the unit is a SERVE COPY REGION —
// a span of source whose every string is read by a Serve user:
//
//   1. a whole file under a Serve-only route (`SERVE_ONLY_DIRS`)
//   2. a `SERVE_*` declaration's initializer, anywhere
//   3. the value of a `serve:` key in a mode-keyed object, anywhere
//
// (2) and (3) are exactly the shapes `docs/product-vocabulary.md` tells you to
// write, which is the point: the recommended pattern is the one this check can
// see. Copy chosen by a bare `isServe ? a : b` ternary is invisible here, and
// that is a reason to prefer a mode-keyed object over a ternary, not a gap to
// paper over with cleverer parsing.
//
// It reads a real TypeScript AST rather than matching text. That is not
// gold-plating: a hand-rolled lexer treats the apostrophe in JSX text like
// `I'm still campaigning` as opening a string literal, and from there it
// swallows every comment and identifier until the next apostrophe. The AST
// also makes "is this a comment", "is this an import specifier", "is this an
// object key" and "is this a className" exact instead of heuristic, which is
// the whole difference between a check people keep and a check people switch
// off.

import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import ts from 'typescript'

// Found by walking up from the cwd rather than from this module's own path:
// the Vitest gate imports it as ESM (no `__dirname`) and tsx runs it as CJS
// (no `import.meta`), and the two callers start in different directories —
// the package root for `npm run -w`, the repo root for the Claude hook.
const findPackageRoot = (): string => {
  const isPackage = (dir: string): boolean => {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) return false
    try {
      return (
        (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string })
          .name === 'gp-webapp'
      )
    } catch {
      return false
    }
  }

  let dir = process.cwd()
  while (true) {
    if (isPackage(dir)) return dir
    const nested = join(dir, 'packages', 'gp-webapp')
    if (isPackage(nested)) return nested
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error('serveVocabulary: could not locate packages/gp-webapp')
    }
    dir = parent
  }
}

export const PACKAGE_ROOT = findPackageRoot()

// Routes whose every string is Serve copy. A subset of `SERVE_ROUTE_PREFIXES`
// in `app/dashboard/shared/serveRoutes.ts` — being serve-GATED is not the same
// as being serve-ONLY, and the difference is load-bearing:
// `SHARED_SERVE_ROUTES` below names the gated routes that Win also reads.
export const SERVE_ONLY_DIRS: readonly string[] = [
  'app/dashboard/chief-of-staff',
  'app/dashboard/briefings',
  'app/dashboard/ordinances',
  'app/dashboard/community-issues',
  'app/dashboard/constituent-outreach',
  'app/dashboard/admin-review/briefings',
  'app/serve',
]

// Serve-gated routes that are NOT serve-only, and why. Listed rather than
// merely omitted so `serveVocabulary.test.ts` can hold every entry of
// SERVE_ROUTE_PREFIXES to one of the two lists: a new Serve route then has to
// be classified by whoever adds it instead of silently going unchecked.
export const SHARED_SERVE_ROUTES: Readonly<Record<string, string>> = {
  '/dashboard/polls':
    'Campaigns commission polls too, so the surface carries Win copy.',
  '/dashboard/public-profile':
    "Shared editor; publicProfileAccess.ts returns 'serve' | 'win'.",
}

const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist', 'e2e-tests'])

// Word-level bans. `\b` on both sides throughout, so "elected" survives
// `election`, "advocate" survives `candidate`, and "vote"/"voting" survive
// `voter` — a legislative vote is a Serve official's whole job.
const BANNED_WORD_PATTERNS: readonly { word: string; pattern: RegExp }[] = [
  { word: 'voter', pattern: /\bvoters?(?:'s?)?\b/gi },
  { word: 'election', pattern: /\belections?\b|\belectoral\b/gi },
  { word: 'candidate', pattern: /\bcandidates?(?:'s?)?\b/gi },
  { word: 'ballot', pattern: /\bballots?\b/gi },
  { word: 'campaign', pattern: /\bcampaigns?\b|\bcampaigning\b/gi },
]

// The outreach-campaign sense, which Serve is welcome to use: a campaign is a
// thing the official SENDS. Matched against a window around the occurrence, so
// "Any phone banking campaign" passes and "Checking your campaign tone" does
// not. Extend this list when a legitimate outreach-campaign phrasing is
// flagged; do not reach for it to let a run-for-office phrase through.
const OUTREACH_CAMPAIGN_SENSE: readonly RegExp[] = [
  // Modified by the channel that sends it.
  /\b(?:outreach|phone[\s-]?bank(?:ing)?|text(?:ing)?|sms|robocall|voicemail|social|email|door[\s-]?knock(?:ing)?|canvass(?:ing)?)\s+campaigns?\b/i,
  // The campaign as a record in the product: its name, its history, its row.
  /\bcampaigns?\s+(?:name|names|history|details|list|title)\b/i,
  /\b(?:name|rename|title)\s+(?:your|this|the)\s+campaigns?\b/i,
  /\bcampaigns?\s+(?:you|they)\s+(?:sent|send|created|scheduled)\b/i,
]

// How wide a window around a `campaign` occurrence the sense patterns get to
// read. Wide enough for "Any phone banking campaign" and a leading article,
// narrow enough that an unrelated clause in the same caption cannot launder it.
const CAMPAIGN_SENSE_WINDOW = 40

export const INLINE_ALLOW = 'serve-vocabulary-allow'
export const FILE_ALLOW = 'serve-vocabulary-allow-file'

// Pre-existing legitimate uses in Serve-only files, kept here rather than as
// inline comments in the product files themselves. Each key is
// `<package-relative path>:<the banned word>`; the value is why it is allowed.
// Prefer an inline `// serve-vocabulary-allow: <why>` in NEW code — it sits
// where the reader is. This list is for the cases where editing the product
// file is not what the change is about.
export const SEEDED_ALLOWLIST: Readonly<Record<string, string>> = {
  'app/serve/onboarding/ServeOfficePicker.tsx:election':
    'Disambiguates cohort twins by the past election the incumbent won: a fact about how they took office, not a race they are running.',
  'app/serve/onboarding/serveOnboardingConfig.ts:election':
    'The "still running" branch of onboarding, which exists to route an official who is also a candidate into Win.',
  'app/serve/onboarding/serveOnboardingConfig.ts:campaign':
    'Same branch — "I\'m still campaigning" is the answer that sends the user to Win.',
  'app/serve/onboarding/serveOnboardingConfig.ts:candidate':
    'Verbatim text of the GoodParty nonpartisan pledge. Quoted, not written.',
  'app/serve/onboarding/ServeOnboardingFlow.tsx:campaign':
    'Renders the same "still campaigning" branch and its redirect into Win onboarding.',
}

// JSX attributes whose value is machinery, not copy. `aria-label`, `title`,
// `placeholder` and `alt` are deliberately absent: a screen reader reads them.
const NON_COPY_JSX_ATTRIBUTES = new Set([
  'className',
  'class',
  'id',
  'key',
  'href',
  'src',
  'to',
  'path',
  'type',
  'name',
  'slug',
  'testId',
  'data-testid',
  'data-test',
  'role',
  'style',
])

export interface ServeVocabularyViolation {
  file: string
  line: number
  word: string
  copy: string
  region: string
}

interface Region {
  start: number
  end: number
  label: string
}

interface CopyNode {
  start: number
  text: string
}

const parse = (file: string, source: string): ts.SourceFile =>
  ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

// `SERVE_*` declarations and `serve:` properties, as initializer spans.
const markedServeRegions = (sourceFile: ts.SourceFile): Region[] => {
  const regions: Region[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^SERVE_[A-Z0-9_]+$/.test(node.name.text) &&
      node.initializer
    ) {
      regions.push({
        start: node.initializer.getStart(sourceFile),
        end: node.initializer.getEnd(),
        label: `${node.name.text} declaration`,
      })
    }

    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'serve'
    ) {
      regions.push({
        start: node.initializer.getStart(sourceFile),
        end: node.initializer.getEnd(),
        label: 'serve: branch of a mode-keyed object',
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return regions
}

// Is this literal a copy string, or is it machinery? The AST answers the
// questions a regex can only guess at: an import specifier, an object key, a
// type-level literal, a className.
const isCopyPosition = (node: ts.Node): boolean => {
  const parent = node.parent
  if (!parent) return true

  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isImportTypeNode(parent) ||
    ts.isModuleDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    ts.isLiteralTypeNode(parent) ||
    ts.isEnumMember(parent) ||
    ts.isJsxNamespacedName(parent)
  ) {
    return false
  }

  // An object key, a class member name or a property access: a name, not copy.
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  ) {
    return false
  }
  if (
    ts.isComputedPropertyName(parent) ||
    ts.isElementAccessExpression(parent)
  ) {
    return false
  }

  // `require('...')` / `import('...')`.
  if (
    ts.isCallExpression(parent) &&
    (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
      parent.expression.getText() === 'require')
  ) {
    return false
  }

  // A string being COMPARED is a matcher, not copy on a screen. This is what
  // makes a derive-by-replace override readable to the check: Serve's thinking
  // stream is Win's list with one message swapped, so the Win string it
  // matches on necessarily appears inside the SERVE_ declaration
  // (`ThinkingStream.tsx`). Flagging it would demand an escape hatch for the
  // correct pattern, which is how a check gets switched off.
  if (
    ts.isBinaryExpression(parent) &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
    ].includes(parent.operatorToken.kind)
  ) {
    return false
  }
  if (ts.isCaseClause(parent)) return false

  if (
    ts.isJsxAttribute(parent) ||
    (parent.parent && ts.isJsxAttribute(parent.parent))
  ) {
    const attribute = ts.isJsxAttribute(parent) ? parent : parent.parent
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      NON_COPY_JSX_ATTRIBUTES.has(attribute.name.text)
    ) {
      return false
    }
  }

  return true
}

const collectCopyNodes = (sourceFile: ts.SourceFile): CopyNode[] => {
  const nodes: CopyNode[] = []

  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      isCopyPosition(node)
    ) {
      nodes.push({ start: node.getStart(sourceFile), text: node.text })
    }

    // A template's `${...}` holds code, so take the literal chunks around the
    // holes separately rather than the whole raw text.
    if (ts.isTemplateExpression(node) && isCopyPosition(node)) {
      nodes.push({
        start: node.head.getStart(sourceFile),
        text: node.head.text,
      })
      for (const span of node.templateSpans) {
        nodes.push({
          start: span.literal.getStart(sourceFile),
          text: span.literal.text,
        })
      }
    }

    if (ts.isJsxText(node) && node.text.trim() !== '') {
      nodes.push({ start: node.getStart(sourceFile), text: node.text })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return nodes
}

// Is this occurrence of "campaign" the outreach kind?
const isOutreachCampaignSense = (text: string, at: number): boolean => {
  const window = text.slice(
    Math.max(0, at - CAMPAIGN_SENSE_WINDOW),
    at + CAMPAIGN_SENSE_WINDOW,
  )
  return OUTREACH_CAMPAIGN_SENSE.some((pattern) => pattern.test(window))
}

// Prose, as opposed to an identifier, a route or an enum value. The rule is
// deliberately blunt: copy has a space in it. `not_a_voter` and
// `voterFileFilterId` do not, and the route forms below cover the ones that do.
const ROUTE_LIKE =
  /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/|^\/|^#|^https?:|\/v\d+\//

const looksLikeCopy = (text: string): boolean => {
  const trimmed = text.trim()
  if (trimmed.length < 4) return false
  if (ROUTE_LIKE.test(trimmed)) return false
  if (!/\s/.test(trimmed)) return false
  return /[A-Za-z]{2}/.test(trimmed)
}

export const scanSource = (
  file: string,
  source: string,
): ServeVocabularyViolation[] => {
  const lines = source.split('\n')
  if (lines.slice(0, 40).some((line) => line.includes(FILE_ALLOW))) return []

  const isServeOnly = SERVE_ONLY_DIRS.some((dir) => file.startsWith(`${dir}/`))
  const sourceFile = parse(file, source)

  const regions: Region[] = isServeOnly
    ? [{ start: 0, end: source.length, label: 'Serve-only file' }]
    : markedServeRegions(sourceFile)
  if (regions.length === 0) return []

  const violations: ServeVocabularyViolation[] = []
  const seen = new Set<string>()

  for (const node of collectCopyNodes(sourceFile)) {
    const region = regions.find(
      (r) => node.start >= r.start && node.start < r.end,
    )
    if (!region) continue
    if (!looksLikeCopy(node.text)) continue

    for (const { word, pattern } of BANNED_WORD_PATTERNS) {
      pattern.lastIndex = 0
      let hit: RegExpExecArray | null
      while ((hit = pattern.exec(node.text))) {
        if (
          word === 'campaign' &&
          isOutreachCampaignSense(node.text, hit.index)
        ) {
          continue
        }
        if (SEEDED_ALLOWLIST[`${file}:${word}`]) continue

        const { line } = sourceFile.getLineAndCharacterOfPosition(node.start)
        const lineNumber = line + 1
        // An allow comment on the offending line, or on the line above it.
        const nearby = `${lines[line] ?? ''}\n${lines[line - 1] ?? ''}`
        if (nearby.includes(INLINE_ALLOW)) continue

        const key = `${file}:${lineNumber}:${word}`
        if (seen.has(key)) continue
        seen.add(key)

        violations.push({
          file,
          line: lineNumber,
          word,
          copy: node.text.trim().replace(/\s+/g, ' ').slice(0, 120),
          region: region.label,
        })
      }
    }
  }

  return violations
}

// A path this check has an opinion about: package-relative, under `app/`, a
// non-test source file. The CLI asks this of a named file rather than walking
// the package to see whether it is in the list, because the per-edit hook pays
// for that walk on every keystroke-sized change.
export const isScannablePath = (file: string): boolean =>
  file.startsWith('app/') &&
  /\.tsx?$/.test(file) &&
  !/\.(?:test|stories)\.tsx?$/.test(file) &&
  !/\.d\.ts$/.test(file) &&
  !file.split('/').some((segment) => IGNORED_DIRS.has(segment))

const walk = async function* (dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      yield* walk(full)
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(?:test|stories)\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      yield full
    }
  }
}

// Every scannable source file in the package, package-relative and
// POSIX-separated so the paths match SERVE_ONLY_DIRS on any platform.
export const serveVocabularyFiles = async (): Promise<string[]> => {
  const files: string[] = []
  for await (const full of walk(join(PACKAGE_ROOT, 'app'))) {
    files.push(relative(PACKAGE_ROOT, full).split(sep).join('/'))
  }
  return files.sort()
}

export const scanServeVocabulary = async (
  files?: string[],
): Promise<ServeVocabularyViolation[]> => {
  const targets = files ?? (await serveVocabularyFiles())
  const found = await Promise.all(
    targets.map(async (file) => {
      const source = await readFile(join(PACKAGE_ROOT, file), 'utf8').catch(
        () => null,
      )
      return source === null ? [] : scanSource(file, source)
    }),
  )
  return found.flat()
}

export const formatViolations = (
  violations: ServeVocabularyViolation[],
): string =>
  violations
    .map(
      ({ file, line, word, copy, region }) =>
        `  ${file}:${line}\n    says "${word}" in Serve copy (${region})\n    > ${copy}`,
    )
    .join('\n\n')

export const VIOLATION_GUIDANCE = `Serve users are elected officials: they have constituents, an office and a term.
Fix by giving the shared component a mode-keyed copy object or an isServe
argument — never by renaming the Win string, which must not change. Models:
  app/dashboard/shared/contactsLabels.ts                       (full label set)
  app/dashboard/door-knocking/native/statusPresentation.ts      (sparse override)
  app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow.tsx  (spread over Win)

"campaign" is fine when it means an outreach campaign ("Campaign name",
"Outreach campaign history") and wrong when it means a run for office
("your campaign tone", "Campaign Manager"). Full rule, and the escape hatch
for a legitimate use: docs/product-vocabulary.md`
