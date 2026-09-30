// --- event card (shared) ----------------------------------------------------
//
// One card for the analytics event explorer, the product map and the event health
// console. It is one piece of code on purpose: three pages describe the same events
// to the same people, and a second, differently-worded description of one event is
// a way for them to disagree. Expects `DATA.event_cards` ({event_type: card}) and
// `DATA.series_weeks` in the page that inlines it.
//
// A page may pass what only it knows, through `opts`:
//   successor   the resolved replacement's name, for the retired verdict
//   before      nodes to place under the verdict (the explorer's caveats)
//   lineage     a node to show instead of the raw supersession prose, or null for none
//   firesPrefix text before "where it fires" ("Browser · ")
//   extraFields [[label, value]] appended to the second grid
//   usedBy      a node to show instead of the default "Used by" list
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

  // A status enum tells the reader nothing. The card owes them a sentence, and for
  // the untrustworthy states it owes them a warning. Tones: good, warn, crit, low.
  const verdictFor = (card, successor) => {
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
        // "The name is still in the code", not "the code is still there": on a row
        // whose call sites are gone, the NAME survives and nothing calls it, and the
        // "In the code" field below is where that is resolved.
        return [
          'warn',
          'Silent',
          'The name is still in the code but nothing has fired for 30 days. Either nobody uses this feature or the instrument broke.',
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
      case 'retired': {
        // `supersession` is prose, not a name, so it is never interpolated raw. A page
        // that has resolved it passes the successor; otherwise the sentence stays
        // quiet rather than guessing.
        const removed = 'Removed ' + shortDate(p.retired_date)
        return [
          'low',
          'Retired',
          successor
            ? removed + ' and replaced by ' + successor + '.'
            : card.supersession
              ? removed + '.'
              : removed + ' and quiet since. Nothing replaced it.',
        ]
      }
      case 'instrumented_never_observed':
        return [
          'crit',
          'Never seen',
          'Recorded as being in the code, but Amplitude has never received it. Either the instrumentation is broken or the code axis is wrong.',
        ]
      case 'code_unknown':
        return [
          'low',
          'Unknown',
          'We cannot tell whether this is still in the code. Usually auto-tracked, or too new to have a provenance record.',
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
  //
  // A card with no `call_site_count` key at all comes from a page that never joined
  // the code axis (the explorer, the map). That is "we did not look", not "we looked
  // and found nothing", so it falls back to the registry's own removal date.
  const inTheCode = (card) => {
    const n = card.call_site_count
    const retired = (card.provenance || {}).retired_date

    if (n === undefined) {
      return retired
        ? 'removed on ' + retired
        : el('span', 'muted', 'still in the code, as far as the registry knows')
    }
    if (n === null) {
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

  // "Where it fires", with how much to trust it. A drafted anchor is a judge's guess,
  // and a low-confidence one says why.
  const firesOn = (card, prefix) => {
    if (!card.fires_on) return null
    const node = el('span')
    if (prefix) add(node, el('span', 'muted', prefix))
    add(node, document.createTextNode(card.fires_on))
    if (card.fires_on_source === 'anchor') {
      let note = ' drafted'
      if (card.anchor_confidence === 'low') {
        note += ', low confidence'
        if (card.anchor_flag_reason) note += ': ' + card.anchor_flag_reason
      }
      add(node, el('span', 'muted', note))
    }
    return node
  }

  const usedByList = (card) => {
    const items = (card.questions || [])
      .map((q) => [q, null])
      .concat((card.used_by || []).map((u) => [u.label, u.url]))
    if (!items.length) return null
    const list = el('ul', 'usedby')
    items.forEach(([label, url]) => {
      const li = el('li')
      if (url) {
        const a = el('a', null, label)
        a.href = url
        a.target = '_blank'
        a.rel = 'noreferrer'
        add(li, a)
      } else li.textContent = label
      add(list, li)
    })
    return list
  }

  const renderEventCard = (eventType, opts) => {
    opts = opts || {}
    const card = EVENT_CARDS[eventType]
    const box = el('div', 'eventcard')

    // No catalog row is the normal state for anything declared in Govern and never
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

    const [tone, label, sentence] = verdictFor(card, opts.successor)
    const head = el('div', 'verdictrow')
    add(head, el('span', 'chip ' + tone, label), el('span', null, sentence))
    add(box, head)
    ;(opts.before || []).forEach((node) => add(box, node))

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

    // Directly under the names, because it is the field that decides whether a
    // retirement is safe: the caveats send you here to check a declared successor.
    if ('lineage' in opts) {
      if (opts.lineage) add(box, opts.lineage)
    } else if (card.supersession) {
      const lineage = el('div', 'lineage')
      add(lineage, el('div', 'fieldlbl', 'Lineage'))
      add(lineage, el('p', null, card.supersession))
      add(box, lineage)
    }

    const top = el('div', 'fields')
    add(top, cardField('What it is', card.description))
    add(top, cardField('Where it fires', firesOn(card, opts.firesPrefix)))
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
    ;(opts.extraFields || []).forEach(([k, v]) => add(mid, cardField(k, v)))
    add(box, mid)

    // Retiring something a report still reads is a different decision from retiring
    // something nothing reads, and that was not visible anywhere on this page.
    const used = 'usedBy' in opts ? opts.usedBy : usedByList(card)
    if (used) add(box, cardField('Used by', used))

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
    add(ids, cardField('Instrumented by', p.instrumented_author_email))
    add(ids, cardField('Removed by', p.retired_author_email))
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
