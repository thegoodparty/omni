import { OutreachType } from '../../generated/prisma'
import { describe, expect, it } from 'vitest'
import { SlackMessageType } from 'src/vendors/slack/slackService.types'
import { buildSlackBlocks } from './voterOutreach.util'

type TextNode = { type: SlackMessageType; text?: string }

const collectTextElementGroups = (node: unknown): TextNode[][] => {
  if (!node || typeof node !== 'object') return []
  const { elements } = node as { elements?: unknown }
  if (!Array.isArray(elements)) return []
  const hasText = elements.every(
    (e) => e && typeof e === 'object' && 'text' in (e as object),
  )
  if (hasText) return [elements as TextNode[]]
  return elements.flatMap(collectTextElementGroups)
}

const findLabeledValue = (
  blocks: ReturnType<typeof buildSlackBlocks>['blocks'],
  label: string,
): string | undefined => {
  const groups = blocks.flatMap(collectTextElementGroups)
  const group = groups.find((els) =>
    els.some((e) => e.type === SlackMessageType.TEXT && e.text === label),
  )
  if (!group) return undefined
  const labelIdx = group.findIndex(
    (e) => e.type === SlackMessageType.TEXT && e.text === label,
  )
  return group[labelIdx + 1]?.text
}

const findDueDateValue = (
  blocks: ReturnType<typeof buildSlackBlocks>['blocks'],
): string | undefined => findLabeledValue(blocks, 'Due Date: ')

describe('buildSlackBlocks - campaignPlanDueDate', () => {
  const baseParams = {
    type: OutreachType.text,
    formattedAudience: [],
  }

  it('renders the due date as-is when a YYYY-MM-DD string is provided', () => {
    const { blocks } = buildSlackBlocks({
      ...baseParams,
      campaignPlanDueDate: '2026-04-19',
    })

    expect(findDueDateValue(blocks)).toBe('2026-04-19')
  })

  it('renders "N/A" when campaignPlanDueDate is omitted', () => {
    const { blocks } = buildSlackBlocks(baseParams)

    expect(findDueDateValue(blocks)).toBe('N/A')
  })
})

describe('buildSlackBlocks - Peerly IDs', () => {
  const baseParams = {
    type: OutreachType.p2p,
    formattedAudience: [],
  }

  it('renders the raw Peerly Job ID when provided', () => {
    const { blocks } = buildSlackBlocks({
      ...baseParams,
      peerlyJobId: 'peerly-job-123',
    })

    expect(findLabeledValue(blocks, 'Peerly Job ID: ')).toBe('peerly-job-123')
  })

  it('renders the Peerly Identity ID when provided', () => {
    const { blocks } = buildSlackBlocks({
      ...baseParams,
      peerlyIdentityId: 'identity-789',
    })

    expect(findLabeledValue(blocks, 'Peerly Identity ID: ')).toBe(
      'identity-789',
    )
  })

  it('renders "N/A" for both Peerly IDs when omitted', () => {
    const { blocks } = buildSlackBlocks(baseParams)

    expect(findLabeledValue(blocks, 'Peerly Job ID: ')).toBe('N/A')
    expect(findLabeledValue(blocks, 'Peerly Identity ID: ')).toBe('N/A')
  })

  it('keeps the clickable Peerly Job Link alongside the raw Job ID', () => {
    const { blocks } = buildSlackBlocks({
      ...baseParams,
      peerlyJobId: 'peerly-job-123',
      peerlyJobUrl: 'https://peerly.com/jobs/peerly-job-123',
    })

    const blob = JSON.stringify(blocks)
    expect(blob).toContain('View Job in Peerly')
    expect(findLabeledValue(blocks, 'Peerly Job ID: ')).toBe('peerly-job-123')
  })
})

describe('buildSlackBlocks - text count', () => {
  const baseParams = {
    type: OutreachType.p2p,
    formattedAudience: [],
  }

  it('renders the total and no billable line when no discount applied', () => {
    const { blocks } = buildSlackBlocks({ ...baseParams, textCount: 5200 })

    expect(findLabeledValue(blocks, '# of Texts: ')).toBe('5,200')
    expect(findLabeledValue(blocks, '# of Billable Texts: ')).toBeUndefined()
  })

  it('renders a separate billable line when a discount applied', () => {
    const { blocks } = buildSlackBlocks({
      ...baseParams,
      textCount: 12259,
      billableTextCount: 7259,
    })

    expect(findLabeledValue(blocks, '# of Texts: ')).toBe('12,259')
    expect(findLabeledValue(blocks, '# of Billable Texts: ')).toBe('7,259')
  })

  it('shows "0" billable when fully covered by the free-texts offer', () => {
    const { blocks } = buildSlackBlocks({
      ...baseParams,
      textCount: 3000,
      billableTextCount: 0,
    })

    expect(findLabeledValue(blocks, '# of Texts: ')).toBe('3,000')
    expect(findLabeledValue(blocks, '# of Billable Texts: ')).toBe('0')
  })

  it('omits the billable line when billable equals total', () => {
    const { blocks } = buildSlackBlocks({
      ...baseParams,
      textCount: 300,
      billableTextCount: 300,
    })

    expect(findLabeledValue(blocks, '# of Texts: ')).toBe('300')
    expect(findLabeledValue(blocks, '# of Billable Texts: ')).toBeUndefined()
  })

  it('renders "N/A" when text count is omitted', () => {
    const { blocks } = buildSlackBlocks(baseParams)

    expect(findLabeledValue(blocks, '# of Texts: ')).toBe('N/A')
    expect(findLabeledValue(blocks, '# of Billable Texts: ')).toBeUndefined()
  })
})
