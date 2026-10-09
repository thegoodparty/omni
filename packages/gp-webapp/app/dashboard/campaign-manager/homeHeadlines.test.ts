import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { CAMPAIGN_TASK_CATALOG } from '@goodparty_org/contracts'
import {
  FIRST_LANDING_HEADLINE,
  HOME_HEADLINES,
  headlineKind,
  pickHeadline,
  useTaskHeadline,
} from './homeHeadlines'

const task = (title: string, flowType: string | null = null, id = title) => ({
  id,
  title,
  flowType,
})

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('headlineKind', () => {
  it('gives every catalog task a kind of its own, never the fallback', () => {
    const unmatched = CAMPAIGN_TASK_CATALOG.filter(
      (def) => headlineKind(task(def.title, def.channel)) === 'other',
    ).map((def) => def.title)

    expect(unmatched).toEqual([])
  })

  it('splits outreach by channel', () => {
    expect(headlineKind(task('Knock on Doors'))).toBe('doorKnocking')
    expect(headlineKind(task('Persuasion Text'))).toBe('text')
    expect(headlineKind(task('Introduction Robocall'))).toBe('robocall')
  })

  it('reads the category before the channel', () => {
    expect(headlineKind(task('Greet voters at the polls'))).toBe('gotv')
    expect(headlineKind(task('Tell us your campaign story'))).toBe('story')
    expect(headlineKind(task('Begin Ballot Access Period'))).toBe('ballot')
  })

  it('falls back to the row’s own channel for a task the catalog lacks', () => {
    expect(headlineKind(task('Canvass the east side', 'doorKnocking'))).toBe(
      'doorKnocking',
    )
    expect(headlineKind(task('Host a meet and greet', 'events'))).toBe('events')
    expect(headlineKind(task('Something new', 'awareness'))).toBe('other')
  })
})

describe('pickHeadline', () => {
  it('never shows the same line twice in a row for a kind', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const [first, second] = HOME_HEADLINES.story
    window.localStorage.setItem(
      'home-headline-last',
      JSON.stringify({ story: [first] }),
    )

    expect(pickHeadline('story')).toBe(second)
    expect(pickHeadline('story')).not.toBe(second)
  })

  it('shows every line of a kind once in a session before any repeats', () => {
    const lines = HOME_HEADLINES.doorKnocking
    const shown = lines.map(() => pickHeadline('doorKnocking'))

    expect(new Set(shown).size).toBe(lines.length)
  })

  it('starts the kind over once all have been shown, without repeating the last', () => {
    const lines = HOME_HEADLINES.text
    const shown = lines.map(() => pickHeadline('text'))

    expect(pickHeadline('text')).not.toBe(shown.at(-1))
  })

  it('keeps each kind’s session separate', () => {
    HOME_HEADLINES.story.forEach(() => pickHeadline('story'))

    expect(HOME_HEADLINES.ballot).toContain(pickHeadline('ballot'))
  })
})

describe('useTaskHeadline', () => {
  it('picks a line for the card’s kind', () => {
    const { result } = renderHook(() =>
      useTaskHeadline(task('Knock on Doors', 'doorKnocking')),
    )

    expect(HOME_HEADLINES.doorKnocking).toContain(result.current)
  })

  it('keeps a card’s line while it stays in front, and switches with the card', () => {
    const story = task('Tell us your campaign story')
    const doors = task('Knock on Doors', 'doorKnocking')
    const { result, rerender } = renderHook(
      ({ front }) => useTaskHeadline(front),
      { initialProps: { front: story } },
    )
    const storyLine = result.current

    rerender({ front: story })
    expect(result.current).toBe(storyLine)

    rerender({ front: doors })
    expect(HOME_HEADLINES.doorKnocking).toContain(result.current)

    rerender({ front: story })
    expect(result.current).toBe(storyLine)
  })

  it('greets the first card on the first landing only', () => {
    const { result, rerender } = renderHook(
      ({ front }) => useTaskHeadline(front, { firstLanding: true }),
      { initialProps: { front: task('Get your EIN') } },
    )
    expect(result.current).toBe(FIRST_LANDING_HEADLINE)

    rerender({ front: task('Knock on Doors', 'doorKnocking') })
    expect(HOME_HEADLINES.doorKnocking).toContain(result.current)
  })

  it('is blank with no card', () => {
    const { result } = renderHook(() => useTaskHeadline(undefined))

    expect(result.current).toBeNull()
  })
})
