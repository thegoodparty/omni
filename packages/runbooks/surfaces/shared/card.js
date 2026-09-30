// --- event card (shared) ----------------------------------------------------
//
// One card for the analytics event explorer, the product map and the event health
// console. It is one piece of code on purpose: three pages describe the same events
// to the same people, and a second, differently-worded description of one event is
// a way for them to disagree. Expects `DATA.event_cards` ({event_type: card}) and
// `DATA.series_weeks` in the page that inlines it.
const EventCard = (() => {
  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  const add = (parent, ...kids) => {
    kids.forEach((k) => k && parent.appendChild(k))
    return parent
  }

  const EVENT_CARDS = DATA.event_cards || {}
  const WEEKS = DATA.series_weeks || []

  const AMPLITUDE_ORG = 'goodparty'

  const amplitudeUrl = (eventType) =>
    'https://app.amplitude.com/data/' +
    AMPLITUDE_ORG +
    '/default/events/main/latest/' +
    encodeURIComponent(eventType) +
    '?view=All&eventsTab=Events&tab=DETAILS' +
    '&propertyValidityFilter=All%2520Properties'

  const prUrl = (pr) =>
    /^\d+$/.test(pr) ? 'https://github.com/thegoodparty/omni/pull/' + pr : pr

  const num = (n) => (n || 0).toLocaleString('en-US')

  const shortDate = (s) => {
    if (!s) return 'an unknown date'
    const d = new Date(s + (s.length === 10 ? 'T00:00:00Z' : ''))
    return isNaN(d)
      ? s
      : d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
  }

  // The explorer's verdicts, word for word. The evidence table shows the raw status
  // because it is a scanning surface with a STATUS header; the card is a reading
  // surface, and there it says what the status means.
  const verdictFor = (card) => {
    const p = card.provenance || {}
    switch (card.status) {
      case 'active':
        return [
          'good',
          'Working',
          'Fired ' +
            num(card.count_30d) +
            ' times in the last 30 days, most recently ' +
            shortDate(card.last_seen) +
            '.',
        ]
      case 'dormant':
        // One word off the explorer's sentence, deliberately. "The code is still
        // there" is the exact ambiguity the fields below resolve: on a rank-2 row the
        // NAME is still there and the caller is gone, and this card is the only place
        // that shows both. The explorer carries no call-site data, so it cannot
        // contradict itself the same way -- but its copy has the same looseness.
        return [
          'warn',
          'Silent',
          'The name is still in the code but nothing has fired for 30 days. Either ' +
            'nobody uses this feature or the instrument broke.',
        ]
      case 'deprecating':
        return [
          'warn',
          'Being removed',
          'The code was removed ' +
            shortDate(p.retired_date) +
            '. Still firing inside the 30-day window, which is expected.',
        ]
      case 'orphaned_firing':
        return [
          'crit',
          'Do not trust this',
          'The code was removed ' +
            shortDate(p.retired_date) +
            ' but events are still arriving. Something is firing that we no longer control.',
        ]
      case 'retired':
        return [
          'low',
          'Retired',
          'Removed ' +
            shortDate(p.retired_date) +
            (card.supersession
              ? '.'
              : ' and quiet since. Nothing replaced it.'),
        ]
      case 'instrumented_never_observed':
        return [
          'crit',
          'Never seen',
          'Recorded as being in the code, but Amplitude has never received it. Either ' +
            'the instrumentation is broken or the code axis is wrong.',
        ]
      case 'code_unknown':
        return [
          'low',
          'Unknown',
          'We cannot tell whether this is still in the code. Usually auto-tracked, or ' +
            'too new to have a provenance record.',
        ]
      case 'system':
        return [
          'low',
          'Auto-tracked',
          'Amplitude records this automatically. It is never health-flagged.',
        ]
      default:
        return ['low', card.status || 'Unknown', '']
    }
  }

  const sparkline = (series) => {
    const box = el('span', 'spark')
    if (!series || !series.length) {
      box.className = 'muted-mono'
      box.textContent = 'no data'
      return box
    }
    const w = 96
    const h = 24
    const gap = 2
    const bw = Math.max(2, (w - gap * (series.length - 1)) / series.length)
    const max = Math.max.apply(null, series.concat([1]))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', w)
    svg.setAttribute('height', h)
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
    series.forEach((v, i) => {
      const bh = v === 0 ? 1 : Math.max(1.5, (v / max) * h)
      const rect = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect',
      )
      rect.setAttribute('x', (i * (bw + gap)).toFixed(1))
      rect.setAttribute('y', (h - bh).toFixed(1))
      rect.setAttribute('width', bw.toFixed(1))
      rect.setAttribute('height', bh.toFixed(1))
      rect.setAttribute('rx', (v === 0 ? 0.5 : Math.min(2, bw / 2)).toFixed(1))
      rect.setAttribute('fill', v === 0 ? 'var(--line-2)' : 'var(--ink-2)')
      const title = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'title',
      )
      title.textContent = 'week of ' + (WEEKS[i] || '') + ': ' + num(v)
      rect.appendChild(title)
      svg.appendChild(rect)
    })
    box.appendChild(svg)
    return box
  }

  const cardField = (label, value) => {
    const node = el('div', 'field')
    add(node, el('div', 'fieldlbl', label))
    const v = el('div', 'v')
    if (value === null || value === undefined || value === '') {
      add(v, el('span', 'muted', '—'))
    } else if (typeof value === 'string' || typeof value === 'number') {
      v.textContent = String(value)
    } else {
      add(v, value)
    }
    add(node, v)
    return node
  }

  // How far this event's removal got, as one sentence.
  //
  // Deleting an event is two steps: delete the code that sends it, then delete its name
  // from the registry. We used to print a field per step -- "name removed: still
  // declared" beside "sent from: nothing" -- and a half-finished deletion read as two
  // facts contradicting each other. It stopped the person who designed the system
  // twice.
  //
  // The two can never both be set, which is what makes one field the honest shape: the
  // count works by finding the name in the registry and counting its references, so
  // deleting the name leaves nothing to count and the column goes null. Measured over
  // 664 events: 372 called, 39 declared-but-uncalled, 162 fully removed, 91 with no
  // resolvable key path.
  const inTheCode = (card) => {
    const n = card.call_site_count
    const retired = (card.provenance || {}).retired_date

    if (n === null || n === undefined) {
      if (retired) return 'removed on ' + retired
      return el(
        'span',
        'muted',
        'no call site we can find, so nothing to follow',
      )
    }
    if (n > 0) {
      return (
        'declared, and called from ' + (n === 1 ? '1 place' : n + ' places')
      )
    }
    return card.call_site_retired_date
      ? 'declared, but nothing has called it since ' +
          card.call_site_retired_date
      : 'declared, but nothing calls it and we cannot date when that changed'
  }

  const cardLink = (label, href) => {
    const a = el('a', 'btn', label)
    a.href = href
    a.target = '_blank'
    a.rel = 'noreferrer'
    return a
  }

  const renderEventCard = (eventType) => {
    const card = EVENT_CARDS[eventType]
    const box = el('div', 'eventcard')

    // No explorer row is the normal state for anything declared in Govern and never
    // observed, which is a third of the flagged set. Say so, and still offer the link
    // out: Amplitude is where a taxonomy-only event actually lives.
    if (!card) {
      add(
        box,
        el(
          'p',
          'muted',
          'No catalog entry for this event. That is expected when it was declared in ' +
            'Amplitude and never fired, since the catalog is built from what arrives.',
        ),
      )
      add(
        box,
        add(
          el('div', 'links'),
          cardLink('Open in Amplitude', amplitudeUrl(eventType)),
        ),
      )
      return box
    }

    const [tone, label, sentence] = verdictFor(card)
    const head = el('div', 'verdictrow')
    add(head, el('span', 'chip ' + tone, label), el('span', null, sentence))
    add(box, head)

    // Both names, always. The display name is a label and can change; the type is
    // the identifier every chart and model filters on and cannot. They differ for
    // 4 of 593 events, which is exactly often enough to be a surprise.
    const names = el('div', 'fields names')
    add(
      names,
      cardField(
        'Display name · a label, changeable',
        card.display_name || eventType,
      ),
    )
    add(
      names,
      cardField(
        'Event type · the identifier, fixed',
        el('span', 'mono', eventType),
      ),
    )
    add(box, names)

    // Directly under the verdict, because it is the field that decides whether a
    // retirement is safe: the caveats send you here to check a declared successor.
    if (card.supersession) {
      const lineage = el('div', 'lineage')
      add(lineage, el('div', 'fieldlbl', 'Lineage'))
      add(lineage, el('p', null, card.supersession))
      add(box, lineage)
    }

    const top = el('div', 'fields')
    add(top, cardField('What it is', card.description))
    add(top, cardField('Where it fires', card.fires_on))
    const vol = el('span', 'volume')
    add(vol, sparkline(card.series))
    add(vol, el('span', 'muted-mono', num(card.count_30d) + ' / 30d'))
    add(top, cardField('Weekly volume', vol))
    add(box, top)

    const p = card.provenance || {}
    const mid = el('div', 'fields')
    add(mid, cardField('Added to the code', p.instrumented_date))
    add(mid, cardField('In the code', inTheCode(card)))
    add(mid, cardField('Last fired', card.last_seen))
    add(mid, cardField('First fired', card.first_seen))
    add(box, mid)

    const used = (card.questions || []).concat(
      (card.used_by || []).map((u) => u.label),
    )
    if (used.length) {
      const list = el('ul', 'usedby')
      used.forEach((u) => add(list, el('li', null, u)))
      // Retiring something a report still reads is a different decision from retiring
      // something nothing reads, and that was not visible anywhere on this page.
      add(box, cardField('Used by', list))
    }

    const links = el('div', 'links')
    add(links, cardLink('Open in Amplitude', amplitudeUrl(eventType)))
    if (card.url && card.url.indexOf('n/a') !== 0) {
      add(links, cardLink(card.url, card.url))
    }
    if (p.instrumented_pr) {
      add(links, cardLink('Instrumenting PR', prUrl(p.instrumented_pr)))
    }
    if (p.retired_pr) add(links, cardLink('Removing PR', prUrl(p.retired_pr)))
    add(box, links)

    const ids = el('div', 'fields prov')
    add(ids, cardField('Product area', card.area))
    add(ids, cardField('Tags', (card.tags || []).join(', ')))
    add(ids, cardField('OKR anchor', card.okr))
    add(ids, cardField('Declared intent', card.declared_intent))
    add(ids, cardField('Watchlist', card.watchlist_status))
    add(ids, cardField('All-time count', num(card.count_total)))
    add(box, ids)

    return box
  }
  return {
    render: renderEventCard,
    amplitudeUrl,
    prUrl,
    num,
    shortDate,
    sparkline,
    verdictFor,
    field: cardField,
    link: cardLink,
  }
})()
