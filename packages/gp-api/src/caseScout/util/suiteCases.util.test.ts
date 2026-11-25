import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SUITE_PATHS } from '../services/caseScoutCaseLists.service'
import { readSuiteCases, type SuiteCase } from './suiteCases.util'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')

describe('readSuiteCases', () => {
  it('reads single- and double-quoted ids and conditions', () => {
    const source = `cases: [
      { id: 'one', grading: { condition: 'First.', handledWhen: 'x' } },
      { id: "two", grading: { condition: "Second.", handledWhen: "y" } },
    ]`
    expect(readSuiteCases(source)).toEqual({
      cases: [
        { caseId: 'one', condition: 'First.' },
        { caseId: 'two', condition: 'Second.' },
      ],
      unreadConditions: 0,
    })
  })

  it('decodes escaped quotes and other escapes', () => {
    const source = String.raw`{ id: 'esc', grading: {
      condition: 'It\'s "fine" \\ \x41B\u{43}\n\tend',
    } }`
    expect(readSuiteCases(source).cases).toEqual([
      { caseId: 'esc', condition: 'It\'s "fine" \\ ABC\n\tend' },
    ])
  })

  it('joins a condition concatenated across lines', () => {
    const source = `{ id: 'joined', grading: {
      condition:
        'The first part, ' +
        "the second part, " +
        \`and a template.\`,
      handledWhen: 'x',
    } }`
    expect(readSuiteCases(source).cases).toEqual([
      {
        caseId: 'joined',
        condition: 'The first part, the second part, and a template.',
      },
    ])
  })

  it('treats a backslash-newline as a line continuation', () => {
    const source = "{ id: 'cont', grading: { condition: 'one \\\ntwo' } }"
    expect(readSuiteCases(source).cases).toEqual([
      { caseId: 'cont', condition: 'one two' },
    ])
  })

  it('ignores keys inside comments and strings', () => {
    const source = `[
      // { id: 'in-a-line-comment', condition: 'no' },
      /* { id: 'in-a-block-comment', condition: 'no' } */
      { id: 'real', input: { turns: ["{ id: 'in-a-string', condition: 'no' }"] },
        grading: { condition: 'Yes.' } },
    ]`
    expect(readSuiteCases(source)).toEqual({
      cases: [{ caseId: 'real', condition: 'Yes.' }],
      unreadConditions: 0,
    })
  })

  it('does not read a URL in a string as a comment', () => {
    const source = `{ id: 'url', input: { turns: ['See https://example.com/a'] },
      grading: { condition: 'Links to https://example.com/b.' } }`
    expect(readSuiteCases(source).cases).toEqual([
      { caseId: 'url', condition: 'Links to https://example.com/b.' },
    ])
  })

  it('counts a template with a substitution as unread', () => {
    const source =
      "{ id: 'tpl', grading: { condition: `Race in ${CITY}.` } }," +
      " { id: 'after', grading: { condition: 'Still read.' } }"
    expect(readSuiteCases(source)).toEqual({
      cases: [{ caseId: 'tpl' }, { caseId: 'after', condition: 'Still read.' }],
      unreadConditions: 1,
    })
  })

  it('counts a variable or a call as unread', () => {
    const source = `[
      { id: 'variable', grading: { condition: SHARED } },
      { id: 'mixed', grading: { condition: 'A ' + SHARED } },
      { id: 'call', grading: { condition: 'a'.trim() } },
    ]`
    expect(readSuiteCases(source)).toEqual({
      cases: [{ caseId: 'variable' }, { caseId: 'mixed' }, { caseId: 'call' }],
      unreadConditions: 3,
    })
  })

  it('reads a case with no condition', () => {
    const source = `[
      { id: 'bare', input: { turns: ['Hi'] } },
      { id: 'graded', grading: { condition: 'Yes.' } },
    ]`
    expect(readSuiteCases(source).cases).toEqual([
      { caseId: 'bare' },
      { caseId: 'graded', condition: 'Yes.' },
    ])
  })

  it('only reads an id key in the case-id alphabet', () => {
    const source = `{ positionId: 'abc', profile: { id: 'has spaces' } },
      { id: 'kept', grading: { condition: 'Yes.' } }`
    expect(readSuiteCases(source).cases).toEqual([
      { caseId: 'kept', condition: 'Yes.' },
    ])
  })
})

const literalText = (node: ts.Expression): string | undefined => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = literalText(node.left)
    const right = literalText(node.right)
    return left === undefined || right === undefined ? undefined : left + right
  }
  return ts.isParenthesizedExpression(node)
    ? literalText(node.expression)
    : undefined
}

const property = (
  node: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined => {
  const found = node.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) &&
      ts.isIdentifier(p.name) &&
      p.name.text === name,
  )
  return found?.initializer
}

// The suite's `cases` array read through the compiler, independently of the
// runtime reader: each case's `id` and `grading.condition`.
const casesFromAst = (file: string, source: string): SuiteCase[] => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const cases: SuiteCase[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'cases' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) {
          throw new Error(`${file}: a case is not an object literal`)
        }
        const idNode = property(element, 'id')
        const caseId = idNode && literalText(idNode)
        if (caseId === undefined) {
          throw new Error(`${file}: a case id is not a string literal`)
        }
        const grading = property(element, 'grading')
        const conditionNode =
          grading && ts.isObjectLiteralExpression(grading)
            ? property(grading, 'condition')
            : undefined
        if (conditionNode === undefined) {
          cases.push({ caseId })
          continue
        }
        const condition = literalText(conditionNode)
        if (condition === undefined) {
          throw new Error(
            `${file}: case ${caseId} has a condition that is not string ` +
              'literals joined by +, which the case scout cannot read',
          )
        }
        cases.push({ caseId, condition })
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return cases
}

// Delegate appends the scout's cases to these files; a shape the runtime
// reader would misread fails here, in the PR that adds it.
describe.each(Object.entries(SUITE_PATHS))(
  'the judged %s suite',
  (agentId, suitePath) => {
    it('reads the same cases the TypeScript compiler does', () => {
      if (suitePath === undefined) throw new Error(`no path for ${agentId}`)
      const source = readFileSync(path.join(REPO_ROOT, suitePath), 'utf8')
      const fromAst = casesFromAst(suitePath, source)
      const read = readSuiteCases(source)

      expect(fromAst.length).toBeGreaterThan(0)
      expect(read.unreadConditions, `unread conditions in ${suitePath}`).toBe(0)
      fromAst.forEach((expected, index) => {
        expect(
          read.cases[index],
          `case ${index} (${expected.caseId}) in ${suitePath}`,
        ).toEqual(expected)
      })
      expect(
        read.cases.map((c) => c.caseId),
        `case ids in ${suitePath}`,
      ).toEqual(fromAst.map((c) => c.caseId))
    })
  },
)
