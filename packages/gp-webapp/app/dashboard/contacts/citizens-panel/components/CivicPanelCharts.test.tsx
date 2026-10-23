import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type {
  CivicPanelCompositionGroup,
  CivicPanelCompositionPlace,
} from '@goodparty_org/contracts'
import { CivicPanelSeats } from './CivicPanelSeats'
import { CivicPanelBloom } from './CivicPanelBloom'
import { CivicPanelMilestones } from './CivicPanelMilestones'

const GOAL = 240
// Fifteen tracts of uneven size, as a city district reads.
const SHARES = [
  0.14, 0.12, 0.09, 0.08, 0.08, 0.07, 0.07, 0.06, 0.06, 0.06, 0.05, 0.05, 0.04,
  0.02, 0.01,
]
const tractName = (i: number) => `${i + 1}.02`

// Members spread by share, the last few tracts trailing.
const placesAt = (members: number, count = SHARES.length) => {
  const shares = SHARES.slice(0, count)
  const total = shares.reduce((a, b) => a + b, 0)
  return shares.map(
    (share, i): CivicPanelCompositionPlace => ({
      key: tractName(i),
      name: tractName(i),
      districtShare: share / total,
      members: Math.round(
        (members * share * (i >= count - 3 ? 0.2 : 1.1)) / total,
      ),
    }),
  )
}

const GROUPS: CivicPanelCompositionGroup[] = [
  { group: 'age18to24', districtShare: 0.11, memberShare: 0.03 },
  { group: 'age25to34', districtShare: 0.18, memberShare: 0.11 },
  { group: 'age35to44', districtShare: 0.17, memberShare: 0.18 },
  { group: 'age45to54', districtShare: 0.16, memberShare: 0.19 },
  { group: 'age55to64', districtShare: 0.17, memberShare: 0.22 },
  { group: 'age65plus', districtShare: 0.21, memberShare: 0.27 },
  { group: 'women', districtShare: 0.52, memberShare: 0.57 },
  { group: 'men', districtShare: 0.48, memberShare: 0.43 },
  { group: 'white', districtShare: 0.78, memberShare: 0.84 },
  { group: 'black', districtShare: 0.1, memberShare: 0.06 },
  { group: 'hispanic', districtShare: 0.07, memberShare: 0.06 },
  { group: 'asian', districtShare: 0.04, memberShare: 0.04 },
]

const viewBoxOf = (svg: Element) => {
  const [x = 0, y = 0, width = 0, height = 0] = (
    svg.getAttribute('viewBox') ?? ''
  )
    .split(' ')
    .map(Number)
  return { x, y, width, height }
}

// The widest a 12px label could run, at about 7px a character.
const labelWidth = (text: Element) =>
  Math.max(
    ...[...text.querySelectorAll('tspan')].map(
      (span) => (span.textContent ?? '').length * 7,
    ),
  )

// Every label must sit inside its chart's frame: the chart scales to the
// card, so a label past the frame would clip or push the page sideways.
const expectLabelsInside = (svg: Element, offsetX = 0) => {
  const box = viewBoxOf(svg)
  for (const text of svg.querySelectorAll('text')) {
    if (text.querySelectorAll('tspan').length === 0) continue
    const x = Number(text.getAttribute('x')) + offsetX
    const width = labelWidth(text)
    const anchor = text.getAttribute('text-anchor')
    const left =
      anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
    expect(left).toBeGreaterThanOrEqual(box.x)
    expect(left + width).toBeLessThanOrEqual(box.x + box.width)
  }
}

const seats = (members: number, count?: number) =>
  render(
    <CivicPanelSeats
      placeKind="tract"
      places={placesAt(members, count)}
      members={members}
      goal={GOAL}
    />,
  )

describe('CivicPanelSeats', () => {
  it('fills nothing and waits for 30 members before comparing', () => {
    seats(0)
    expect(
      screen.getByRole('img', {
        name: 'Your district as 100 seats. 0 of 100 seats filled.',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "We'll compare your panel with your district once 30 people join.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Behind the rest')).not.toBeInTheDocument()
  })

  it('fills seats under 30 members without calling anyone behind', () => {
    seats(20)
    expect(screen.queryByText('Furthest behind')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "We'll compare your panel with your district once 30 people join.",
      ),
    ).toBeInTheDocument()
  })

  it('lists the tracts furthest behind, and leaves who to invite to the balance card', () => {
    seats(120)
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem').length).toBeLessThanOrEqual(5)
    expect(within(list).getByText('Tract 15.02')).toBeInTheDocument()
    expect(screen.getByText(/of 15 tracts are behind the rest\./)).toBeVisible()
    expect(screen.queryByText(/^Invite more/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /tracts are behind the rest\.$/ }),
    ).toBeInTheDocument()
  })

  it('lists the most empty seats near the goal when there are too many tracts to name', () => {
    seats(200)
    expect(screen.getByText('Most empty seats')).toBeInTheDocument()
    expect(screen.getByText(/^Empty seats are in \d+ of 15 tracts\.$/))
    // One arc, unlabeled.
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('names each tract around the arc near the goal, inside the frame', () => {
    const { container } = seats(200, 12)
    const [labeled, plain] = container.querySelectorAll('svg')
    expect(labeled?.getAttribute('class')).toContain('hidden sm:block')
    expect(plain?.getAttribute('class')).toContain('sm:hidden')
    expect(labeled?.querySelectorAll('text').length).toBe(12)
    expect(plain?.querySelectorAll('text').length).toBe(0)
    // The labels' translate moves (0, 0) to the arc's center.
    const center = Number(
      /translate\(([\d.]+)/.exec(
        labeled?.querySelector('g')?.getAttribute('transform') ?? '',
      )?.[1],
    )
    if (labeled) expectLabelsInside(labeled, center)
  })

  it('colors filled seats in brand families, outlined, and leaves empty seats plain', () => {
    const { container } = seats(120)
    const circles = [...container.querySelectorAll('circle')]
    const filled = circles.filter((c) =>
      /fill-brand-/.test(c.getAttribute('class') ?? ''),
    )
    const empty = circles.filter((c) =>
      (c.getAttribute('class') ?? '').includes('fill-background'),
    )
    expect(filled.length).toBeGreaterThan(0)
    expect(filled.length + empty.length).toBe(100)
    const classes = filled.map((c) => c.getAttribute('class') ?? '')
    for (const family of ['red', 'blue', 'lavender']) {
      expect(classes.some((c) => c.includes(`fill-brand-${family}-`))).toBe(
        true,
      )
    }
    for (const c of classes) {
      expect(c).toMatch(/stroke-brand-(red|blue|lavender)-\d+/)
      expect(c).not.toContain('fill-primary')
    }
    for (const c of empty) {
      expect(c.getAttribute('class')).toMatch(/stroke-(border|warning)/)
    }
  })

  it('says every tract has its share once every seat is filled', () => {
    render(
      <CivicPanelSeats
        placeKind="tract"
        places={SHARES.map((share, i) => ({
          key: tractName(i),
          name: tractName(i),
          districtShare: share,
          members: Math.ceil(share * GOAL),
        }))}
        members={GOAL}
        goal={GOAL}
      />,
    )
    expect(
      screen.getByText('Every tract has its share of seats filled.'),
    ).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })
})

describe('CivicPanelSeats by precinct', () => {
  it('names the seats by precinct where the district has no tract data', () => {
    render(
      <CivicPanelSeats
        placeKind="precinct"
        places={placesAt(120).map((place, i) => ({
          ...place,
          name: `0${i + 1}.1`,
        }))}
        members={120}
        goal={GOAL}
      />,
    )
    expect(
      screen.getByRole('heading', { name: "Who's on your panel, by precinct" }),
    ).toBeInTheDocument()
    expect(screen.getByText('Precinct 015.1')).toBeInTheDocument()
    expect(
      screen.getByText(/of 15 precincts are behind the rest\./),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Invite more/)).not.toBeInTheDocument()
  })
})

describe('CivicPanelSeats with tract names', () => {
  const NAMES = [
    'West Asheville, around Haywood Rd',
    'Biltmore Village',
    'around Merrimon Ave',
  ]
  // The last tracts trail, and the three furthest behind have names but
  // one: it keeps its number.
  const named = (members: number, count?: number) =>
    placesAt(members, count).map((place, i, all) => {
      const fromEnd = all.length - 1 - i
      const label = fromEnd === 1 ? undefined : NAMES[fromEnd]
      return label ? { ...place, label } : place
    })

  it('names the tracts furthest behind, and keeps the number for one without a name', () => {
    render(
      <CivicPanelSeats
        placeKind="tract"
        places={named(120)}
        members={120}
        goal={GOAL}
      />,
    )
    const list = screen.getByRole('list')
    const row = within(list).getByText('West Asheville, around Haywood Rd')
    expect(row).toHaveClass('truncate')
    expect(row).toHaveAttribute('title', 'West Asheville, around Haywood Rd')
    expect(within(list).getByText('Tract 14.02')).toBeInTheDocument()
    expect(within(list).getByText('around Merrimon Ave')).toBeInTheDocument()
  })

  it('cuts a long name short around the arc, inside the frame, with the whole name as its tooltip', () => {
    const { container } = render(
      <CivicPanelSeats
        placeKind="tract"
        places={named(200, 12)}
        members={200}
        goal={GOAL}
      />,
    )
    const [labeled] = container.querySelectorAll('svg')
    const names = [...(labeled?.querySelectorAll('text') ?? [])].map(
      (text) => text.querySelector('tspan')?.textContent,
    )
    expect(names).toContain('West Ashevill…')
    expect(names).toContain('Tract 11.02')
    const titles = [...(labeled?.querySelectorAll('text > title') ?? [])].map(
      (title) => title.textContent,
    )
    expect(titles).toContain('West Asheville, around Haywood Rd')
    const center = Number(
      /translate\(([\d.]+)/.exec(
        labeled?.querySelector('g')?.getAttribute('transform') ?? '',
      )?.[1],
    )
    if (labeled) expectLabelsInside(labeled, center)
  })
})

describe('CivicPanelBloom', () => {
  it('counts the groups at their share and labels each petal', () => {
    const { container } = render(<CivicPanelBloom groups={GROUPS} showNext />)
    expect(
      screen.getAllByRole('img', {
        name: '9 of 12 groups have at least their share of members.',
        hidden: true,
      }),
    ).toHaveLength(2)
    expect(screen.getAllByText('9 of 12')).toHaveLength(2)
    // On a phone the names list under the flower.
    const list = screen.getByRole('list')
    expect(within(list).getByText('18 to 24')).toBeInTheDocument()
    expect(within(list).getByText('27% of its share')).toBeInTheDocument()
    expect(within(list).getAllByText('About its share').length).toBeGreaterThan(
      0,
    )
    // Who to invite is the API's call, so the petals never name one.
    expect(screen.queryByText(/^Invite more/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Every group has its share.'),
    ).not.toBeInTheDocument()
    const [labeled] = container.querySelectorAll('svg')
    if (labeled) expectLabelsInside(labeled)
  })

  it('says every group has its share, or nothing when the status names one', () => {
    const even = GROUPS.map((g) => ({ ...g, memberShare: g.districtShare }))
    const { unmount } = render(<CivicPanelBloom groups={even} showNext />)
    expect(screen.getByText('Every group has its share.')).toBeInTheDocument()
    unmount()

    render(<CivicPanelBloom groups={GROUPS} showNext={false} />)
    expect(screen.queryByText(/^Invite more/)).not.toBeInTheDocument()
  })
})

describe('CivicPanelMilestones', () => {
  const progressAt = (members: number) => ({
    members,
    goal: GOAL,
    answersNeeded: 96,
    expectedAnswers: 0,
    groupsCovered: 10,
    groupsTotal: 12,
  })
  const at = (
    members: number,
    places = placesAt(members),
    groups: CivicPanelCompositionGroup[] = [],
  ) =>
    render(
      <CivicPanelMilestones
        progress={progressAt(members)}
        composition={{ placeKind: 'tract', places, groups }}
      />,
    )

  it('says how many tracts keep pace halfway there', () => {
    at(120)
    expect(
      screen.getByRole('heading', { name: 'Halfway there' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /^120 residents have said yes, and \d+ of 15 tracts are keeping pace\.$/,
      ),
    ).toBeInTheDocument()
  })

  it('counts the seats to go near the goal', () => {
    at(200)
    expect(screen.getByRole('heading', { name: 'Almost there' })).toBeVisible()
    expect(
      screen.getByText(/^\d+ seats to go, and \d+ of 15 tracts are full\.$/),
    ).toBeInTheDocument()
  })

  it('shows the full panel once every seat is filled', () => {
    at(
      GOAL,
      SHARES.map((share, i) => ({
        key: tractName(i),
        name: tractName(i),
        districtShare: share,
        members: Math.ceil(share * GOAL),
      })),
      GROUPS,
    )
    expect(
      screen.getByRole('heading', { name: 'Every seat is filled' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('240 residents from all 15 tracts said yes.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('civic-panel-milestones')).toHaveTextContent(
      '9 of 12 groups at their share',
    )
  })

  it('counts groups the way the petals do, not the covered groups', () => {
    at(
      GOAL,
      SHARES.map((share, i) => ({
        key: tractName(i),
        name: tractName(i),
        districtShare: share,
        members: Math.ceil(share * GOAL),
      })),
    )
    // Without petals there is no group count to show.
    expect(screen.getByTestId('civic-panel-milestones')).not.toHaveTextContent(
      'groups',
    )
  })
})

// Server and client can print a float's last digit differently, which React
// reports as a hydration mismatch, so every drawn coordinate is rounded.
describe('chart coordinates', () => {
  const COORDS = ['x', 'y', 'cx', 'cy']
  const expectRounded = (container: HTMLElement) => {
    const values = [...container.querySelectorAll('svg *')].flatMap((node) =>
      COORDS.map((name) => node.getAttribute(name)).filter(
        (value): value is string => value !== null,
      ),
    )
    const paths = [...container.querySelectorAll('svg path')].flatMap(
      (node) => (node.getAttribute('d') ?? '').match(/-?[\d.]+/g) ?? [],
    )
    expect(values.length).toBeGreaterThan(0)
    for (const value of [...values, ...paths]) {
      expect(value).toMatch(/^-?\d+(\.\d{1,2})?$/)
    }
  }

  it('rounds the seats and their labels', () => {
    const { container } = seats(200, 12)
    expectRounded(container)
  })

  it('rounds the petals and their labels', () => {
    const { container } = render(
      <CivicPanelBloom groups={GROUPS} showNext={false} />,
    )
    expectRounded(container)
  })
})
