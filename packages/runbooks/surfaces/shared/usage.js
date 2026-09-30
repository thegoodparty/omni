// ---- usage and feedback (shared) --------------------------------------------------
// Every published surface is instrumented the same way: no server, so what people
// do here goes to the artifact's own store, one document per visit, read back later.
// Rows carry the viewer's opaque id and never a name: names differ per viewer and go
// stale, so they are resolved at render time instead.
//
// A page calls USAGE.init({ snapshot, onCaps }) once. `onCaps` runs when the comment
// composer turns out to be available, so the page can draw its feedback button.
// The owner gets `is-owner` on <body>, which is what reveals [data-owner-only].
var USAGE = (function () {
  var opts = {}
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c]
    })
  }
  function badge(tone, text) {
    return '<span class="badge b-' + tone + '">' + esc(text) + '</span>'
  }
  function shortDate(s) {
    if (!s) return ''
    var d = new Date(s)
    return isNaN(d)
      ? String(s)
      : d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
  }
  var udb = null,
    uuser = null,
    ucomments = null
  var me = null,
    owner = false,
    ref = null,
    doc = null
  var timer = null,
    saving = false,
    again = false,
    dead = false,
    fails = 0,
    lastQ = ''
  // db codes where the contract says retrying cannot succeed.
  var TERMINAL = [
    'quota_exceeded',
    'invalid_argument',
    'revoked',
    'not_granted',
    'capability_disabled',
    'capability_removed',
    'transform_error',
  ]

  function newId() {
    return (
      new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) +
      '-' +
      Math.random().toString(36).slice(2, 8)
    )
  }

  function schedule() {
    if (dead || !ref) return
    clearTimeout(timer)
    timer = setTimeout(flush, 1500)
  }

  // One write at a time per document. Memory is the source of truth and the document
  // is its projection, so a full set() never has to read-modify-write a counter.
  function flush() {
    if (dead || !ref) return
    if (saving) {
      again = true
      return
    }
    saving = true
    doc.last_at = new Date().toISOString()
    ref.set(doc).then(
      function () {
        saving = false
        fails = 0
        if (again) {
          again = false
          schedule()
        }
      },
      function (e) {
        saving = false
        // Only the codes the contract calls terminal stop this visit recording.
        // Everything else — `unavailable` above all, the one documented as
        // retryable — gets another attempt, bounded so a persistent refusal
        // cannot spin. Killing tracking on any error meant one permission refusal
        // on the first write lost the whole visit.
        if (TERMINAL.indexOf((e && e.code) || '') >= 0) dead = true
        else if (++fails >= 3) dead = true
        else schedule()
      },
    )
  }

  function capped(arr, n, v) {
    if (arr.length < n) arr.push(v)
  }

  function init(options) {
    opts = options || {}
    document.addEventListener(
      'click',
      function (ev) {
        var fb = ev.target.closest('[data-feedback]')
        if (fb) {
          ev.preventDefault()
          feedback(fb)
          return
        }
        var a = ev.target.closest('a[href^="http"]')
        if (a) clicked(a.getAttribute('href'))
      },
      true,
    )
    if (!window.claude || !claude.use) return
    Promise.all([
      claude.use('user'),
      claude.use('db'),
      claude.use('comments'),
    ]).then(
      function (caps) {
        uuser = caps[0]
        udb = caps[1]
        ucomments = caps[2]
        var who = uuser
          ? Promise.all([uuser.id(), uuser.isOwner()])
          : Promise.resolve([null, false])
        return who.then(function (r) {
          me = r[0]
          owner = r[1]
          if (udb) {
            ref = udb.collection('sessions').doc(newId())
            doc = {
              viewer: me || '',
              started_at: new Date().toISOString(),
              last_at: new Date().toISOString(),
              snapshot: opts.snapshot || '',
              searches: [],
              events: [],
              questions: [],
              clicks: {},
              feedback: 0,
            }
            flush() // a visit with no interaction is still a visit
          }
          if (owner) document.body.classList.add('is-owner')
          // Now the page knows both what it can do and who is looking, so it can draw
          // the feedback button and any owner-only exits in one pass.
          if (opts.onCaps) opts.onCaps()
          if (owner && udb) panel()
        })
      },
      function () {
        /* no viewer answered; the page is unchanged */
      },
    )
  }

  // ---- what gets recorded ----
  function search(q, total, question, partial) {
    q = (q || '').trim()
    if (!doc || q.length < 2 || q === lastQ) return
    lastQ = q
    capped(doc.searches, 150, {
      q: q,
      total: total,
      question: !!question,
      partial: !!partial,
    })
    schedule()
  }
  function opened(name) {
    if (!doc || doc.events.indexOf(name) >= 0) return
    capped(doc.events, 200, name)
    schedule()
  }
  function picked(qid) {
    if (!doc || doc.questions.indexOf(qid) >= 0) return
    capped(doc.questions, 60, qid)
    schedule()
  }
  // Classify by destination rather than by tagging every builder: a link added later
  // is counted without anyone remembering to mark it.
  function kindOf(href) {
    if (href.indexOf('amplitude.com') >= 0) return 'amplitude'
    if (href.indexOf('github.com') >= 0) return 'github'
    if (href.indexOf('/v/fm/') >= 0) return 'form'
    if (href.indexOf('clickup.com') >= 0) return 'ticket'
    if (href.indexOf('slack.com') >= 0) return 'slack'
    if (href.indexOf('claude.ai') >= 0) return 'answer'
    if (href.indexOf('goodparty.org') >= 0) return 'product'
    return 'other'
  }
  function clicked(href) {
    if (!doc) return
    var k = kindOf(href)
    doc.clicks[k] = (doc.clicks[k] || 0) + 1
    schedule()
  }

  // ---- feedback: the shell's own composer, so nothing is posted by the page ----
  function feedback(el) {
    if (!ucomments) return
    if (doc) {
      doc.feedback = (doc.feedback || 0) + 1
      schedule()
    }
    ucomments.openComposer({ element: el }).then(
      function (r) {
        if (!r || r.opened) return
        el.setAttribute('data-note', 'finish the comment you already started')
      },
      function () {
        ucomments = null
        if (opts.onCaps) opts.onCaps()
      },
    )
  }

  // ---- owner-only read-out ----
  function panel() {
    var host = document.getElementById('usage')
    if (!host) return
    host.hidden = false
    host.innerHTML =
      '<div class="sechead"><span class="sectoggle">Usage</span>' +
      '<span class="note" style="margin:0">only you see this panel</span></div><p class="note">reading…</p>'
    udb
      .collection('sessions')
      .orderBy('started_at', 'desc')
      .limit(300)
      .get()
      .then(function (snap) {
        var rows = snap.docs.map(function (d) {
          return d.data()
        })
        var people = {},
          queries = {},
          clicks = {},
          feedback = 0
        rows.forEach(function (r) {
          var v = r.viewer || 'unknown'
          var p =
            people[v] ||
            (people[v] = { visits: 0, searches: 0, events: 0, last: '' })
          p.visits++
          p.searches += (r.searches || []).length
          p.events += (r.events || []).length
          if ((r.last_at || '') > p.last) p.last = r.last_at || ''
          feedback += r.feedback || 0
          Object.keys(r.clicks || {}).forEach(function (k) {
            clicks[k] = (clicks[k] || 0) + (r.clicks[k] || 0)
          })
          ;(r.searches || []).forEach(function (s) {
            var key = (s.q || '').toLowerCase()
            var q =
              queries[key] ||
              (queries[key] = { q: s.q, n: 0, empty: 0, partial: 0 })
            q.n++
            if (!s.total) q.empty++
            if (s.partial) q.partial++
          })
        })
        var ids = Object.keys(people).filter(function (v) {
          return v !== 'unknown'
        })
        var profs = uuser ? uuser.profiles(ids) : Promise.resolve({})
        return profs.then(function (ps) {
          var order = Object.keys(people).sort(function (a, b) {
            return people[b].visits - people[a].visits
          })
          var who = order
            .map(function (v) {
              var pr = ps[v] || {},
                p = people[v]
              var label =
                pr.name || (v === 'unknown' ? 'not signed in' : 'someone')
              return (
                '<tr><td>' +
                esc(label) +
                (pr.email
                  ? ' <span class="muted mono">' + esc(pr.email) + '</span>'
                  : '') +
                '</td><td class="num">' +
                p.visits +
                '</td><td class="num">' +
                p.searches +
                '</td><td class="num">' +
                p.events +
                '</td><td class="date">' +
                esc(shortDate(p.last)) +
                '</td></tr>'
              )
            })
            .join('')
          var qs = Object.keys(queries)
            .map(function (k) {
              return queries[k]
            })
            .sort(function (a, b) {
              return b.empty - a.empty || b.n - a.n
            })
            .slice(0, 40)
            .map(function (q) {
              var flag = q.empty
                ? badge('crit', 'found nothing')
                : q.partial
                  ? badge('warn', 'closest matches')
                  : ''
              return (
                '<tr><td>' +
                esc(q.q) +
                '</td><td class="num">' +
                q.n +
                '</td><td>' +
                flag +
                '</td></tr>'
              )
            })
            .join('')
          var ck =
            Object.keys(clicks)
              .sort(function (a, b) {
                return clicks[b] - clicks[a]
              })
              .map(function (k) {
                return esc(k) + ' ' + clicks[k]
              })
              .join(' · ') || 'none yet'
          host.innerHTML =
            '<div class="sechead"><span class="sectoggle">Usage</span>' +
            '<span class="note" style="margin:0">only you see this panel</span></div>' +
            '<p class="note" style="margin-top:0">' +
            rows.length +
            ' visits · ' +
            order.length +
            ' people · ' +
            feedback +
            ' feedback comments opened · links out: ' +
            ck +
            '</p>' +
            '<div class="usagegrid">' +
            '<div class="tablewrap"><table><thead><tr><th>Who</th><th>Visits</th><th>Searches</th><th>Events opened</th><th>Last seen</th></tr></thead><tbody>' +
            (who || '<tr><td colspan="5" class="muted">nobody yet</td></tr>') +
            '</tbody></table></div>' +
            '<div class="tablewrap"><table><thead><tr><th>What they searched</th><th>Times</th><th></th></tr></thead><tbody>' +
            (qs ||
              '<tr><td colspan="3" class="muted">no searches yet</td></tr>') +
            '</tbody></table></div>' +
            '</div>' +
            '<p class="note">Stored with the page, so anyone here who opens it could read these rows. ' +
            'Names are resolved as you view them and are never written down.</p>'
        })
      })
      .then(null, function () {
        host.innerHTML =
          '<div class="sechead"><span class="sectoggle">Usage</span></div>' +
          '<p class="note">could not read the usage store</p>'
      })
  }

  return {
    init: init,
    search: search,
    opened: opened,
    picked: picked,
    clicked: clicked,
    feedback: feedback,
    canComment: function () {
      return !!ucomments
    },
    isOwner: function () {
      return owner
    },
  }
})()
