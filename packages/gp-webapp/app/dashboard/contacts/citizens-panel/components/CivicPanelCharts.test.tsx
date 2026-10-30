import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type {
  CivicPanelCompositionGroup,
  CivicPanelCompositionPlace,
} from '@goodparty_org/contracts'
import { CivicPanelSeats } from './CivicPanelSeats'
import { CivicPanelBloom } from './CivicPanelBloom'
import { CivicPanelHero } from './CivicPanelHero'

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
        name: 'Your district as 100 seats. 0 of 100 seats filled, counting each tract only up to its share.',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Behind the rest')).not.toBeInTheDocument()
  })

  it('fills seats under 30 members without calling anyone behind', () => {
    seats(20)
    expect(screen.queryByText('Behind the rest')).not.toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /only up to its share\.$/ }),
    ).toBeInTheDocument()
  })

  // Which places are behind is the civic panel page's to list, so the
  // chart outlines them and names none.
  it('outlines the tracts behind the rest without listing them', () => {
    const { container } = seats(120)
    expect(screen.getByText('Behind the rest')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /tracts are behind the rest\.$/ }),
    ).toBeInTheDocument()
    expect(
      container.querySelectorAll('circle.stroke-warning').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByText('Furthest behind')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Invite more/)).not.toBeInTheDocument()
  })

  it('draws one unlabeled arc near the goal, the same on a phone and a computer', () => {
    const { container } = seats(200, 12)
    const arcs = container.querySelectorAll('svg')
    expect(arcs).toHaveLength(1)
    expect(arcs[0]?.getAttribute('class')).not.toContain('hidden')
    expect(arcs[0]?.querySelectorAll('text')).toHaveLength(0)
    expect(screen.getByText('Empty seat')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByText('Most empty seats')).not.toBeInTheDocument()
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

  it('counts every seat once every tract has its share', () => {
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
      screen.getByText(
        '100 of 100 seats filled, counting each tract only up to its share',
      ),
    ).toBeInTheDocument()
  })

  it("counts a crowded tract's members only up to its share", () => {
    render(
      <CivicPanelSeats
        placeKind="tract"
        places={SHARES.map((share, i) => ({
          key: tractName(i),
          name: tractName(i),
          districtShare: share,
          members: i === 0 ? GOAL : 0,
        }))}
        members={GOAL}
        goal={GOAL}
      />,
    )
    const filled = Math.round((SHARES[0] ?? 0) * 100)
    expect(
      screen.getByText(
        `${filled} of 100 seats filled, counting each tract only up to its share`,
      ),
    ).toBeInTheDocument()
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
      screen.getByRole('heading', {
        name: "Who's on your civic panel, by precinct",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /precincts are behind the rest\.$/ }),
    ).toBeInTheDocument()
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

describe('CivicPanelHero', () => {
  const filledSeats = (container: HTMLElement) =>
    container.querySelectorAll('circle[data-source]').length

  it('starts with every seat empty and no milestone done', () => {
    const { container } = render(
      <CivicPanelHero stage="start" members={0} goal={GOAL} />,
    )
    expect(
      screen.getByRole('heading', { name: 'Your civic panel starts here' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Every resident who says yes joins your civic panel.'),
    ).toBeInTheDocument()
    expect(filledSeats(container)).toBe(0)
    expect(screen.getByText('First yes')).toHaveTextContent('Next')
  })

  it('fills the seats as a share of the goal', () => {
    const { container } = render(
      <CivicPanelHero stage="building" members={120} goal={GOAL} />,
    )
    expect(
      screen.getByText(
        '120 residents are ready to share their views, on the way to 240.',
      ),
    ).toBeInTheDocument()
    expect(filledSeats(container)).toBe(50)
    expect(screen.getByText('Halfway')).toHaveTextContent('Done')
    expect(screen.getByText('Full civic panel')).toHaveTextContent('Next')
  })

  it('says how many joined over the bar only at the start, where the line does not', () => {
    render(<CivicPanelHero stage="start" members={0} goal={GOAL} />)
    expect(
      within(screen.getByTestId('civic-panel-hero-bar')).getByText(
        '0 of 240 residents have joined',
      ),
    ).toBeInTheDocument()
  })

  it('draws the seats from lg and a bar below it, the milestones under both', () => {
    const { container } = render(
      <CivicPanelHero stage="building" members={60} goal={GOAL} />,
    )
    const arc = container.querySelector('svg')?.parentElement
    expect(arc).toHaveClass('hidden', 'lg:flex')
    const bar = screen.getByTestId('civic-panel-hero-bar')
    expect(bar).toHaveClass('lg:hidden')
    // The line above already says how many joined, so the bar does not.
    expect(
      screen.getByText(
        '60 residents are ready to share their views, on the way to 240.',
      ),
    ).toBeInTheDocument()
    expect(
      within(bar).queryByText('60 of 240 residents have joined'),
    ).not.toBeInTheDocument()
    expect(
      within(bar).getByRole('img', {
        name: '60 of 240 residents have joined',
      }),
    ).toBeInTheDocument()
    expect(bar.querySelector('[data-source="text"]')).toHaveStyle({
      width: '25%',
    })
    const steps = screen.getByRole('list', {
      name: "Your civic panel's milestones",
    })
    expect(
      bar.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('names a precinct district by precinct, never by tract', () => {
    render(<CivicPanelHero stage="building" members={60} goal={GOAL} />)
    const arc = screen.getByTestId('civic-panel-hero-seats')
    expect(arc).toHaveAttribute(
      'aria-label',
      'Your district as 100 seats. 25 of 100 seats filled.',
    )
    expect(arc.getAttribute('aria-label')).not.toMatch(/tract/)
  })

  it('splits the bar and the seats by how members joined', () => {
    const { container } = render(
      <CivicPanelHero
        stage="exhausted"
        members={120}
        goal={GOAL}
        joinedBy={{ text: 90, door: 18, phone: 0, hand: 12 }}
      />,
    )
    const bar = screen.getByTestId('civic-panel-hero-bar')
    expect(bar.querySelector('[data-source="text"]')).toHaveStyle({
      width: '37.5%',
    })
    // Added by hand counts with the door.
    expect(bar.querySelector('[data-source="door"]')).toHaveStyle({
      width: '12.5%',
    })
    expect(bar.querySelector('[data-source="phone"]')).toBeNull()
    const legend = screen.getByTestId('civic-panel-hero-bar-legend')
    expect(within(legend).getByText('90 by text')).toBeInTheDocument()
    expect(within(legend).getByText('30 at the door')).toBeInTheDocument()
    expect(within(legend).queryByText(/by phone/)).not.toBeInTheDocument()
    expect(within(legend).queryByText('Empty seat')).not.toBeInTheDocument()

    expect(
      container.querySelectorAll('circle[data-source="text"]').length,
    ).toBe(38)
    expect(
      container.querySelectorAll('circle[data-source="door"]').length,
    ).toBe(12)
    expect(
      within(screen.getByTestId('civic-panel-hero-seats-legend')).getByText(
        'Empty seat',
      ),
    ).toBeInTheDocument()
  })

  it('shows no legend before anyone joins', () => {
    render(<CivicPanelHero stage="start" members={0} goal={GOAL} />)
    expect(
      screen.queryByTestId('civic-panel-hero-bar-legend'),
    ).not.toBeInTheDocument()
  })

  it('never claims seats a ready panel lost', () => {
    render(<CivicPanelHero stage="ready" members={230} goal={GOAL} />)
    expect(
      screen.getByText(
        '230 residents are on your civic panel. Ask them before your next vote.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/seats are filled/)).not.toBeInTheDocument()
  })

  it('says every seat is filled once it is ready at its goal', () => {
    const { container } = render(
      <CivicPanelHero stage="ready" members={260} goal={GOAL} />,
    )
    expect(
      screen.getByRole('heading', { name: 'Your civic panel is ready' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'All 240 seats are filled. Ask them before your next vote.',
      ),
    ).toBeInTheDocument()
    expect(filledSeats(container)).toBe(100)
  })

  it('says every resident we can text has an invite', () => {
    render(<CivicPanelHero stage="exhausted" members={90} goal={GOAL} />)
    expect(
      screen.getByRole('heading', {
        name: 'Every resident we can text has an invite',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('90 of 240 residents have joined your civic panel.'),
    ).toBeInTheDocument()
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

  it('rounds the seats', () => {
    const { container } = seats(200, 12)
    expectRounded(container)
  })

  it('rounds the hero seats', () => {
    const { container } = render(
      <CivicPanelHero stage="building" members={77} goal={GOAL} />,
    )
    expectRounded(container)
  })

  it('rounds the petals and their labels', () => {
    const { container } = render(
      <CivicPanelBloom groups={GROUPS} showNext={false} />,
    )
    expectRounded(container)
  })
})
