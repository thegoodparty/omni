# Flow spec and ways in

## doors.json

The ways in: every place a user can arrive at the feature, each with its own entry
board. Find them in the ticket, the meeting notes and the code (routes, modals,
emails, nav). A door the ticket forgets is the most common gap these canvases
catch.

```json
[
  {"key": "email", "board": "E-Email.dc.html", "name": "Emailed link from candidate success"},
  {"key": "signin", "board": "E-SignIn.dc.html", "name": "Signs in on their own"}
]
```

`key` is short and lowercase. It's the `#from=<key>` hash every option reads.

## specs/<ID>.json

One per option. `flowstrip.py` turns it into the flow board above the wireframe,
and `build_canvas.py` uses it for layout. Write it from the wireframe's real logic
(read the board and click through it), never from memory.

```json
{
  "id": "A",
  "file": "W-A-Steps.dc.html",
  "name": "A · Short steps",
  "short": "Three one-question screens, then one screen to check every answer.",
  "layout": "close",
  "family": "Form",
  "landName": "Chief of Staff",
  "entries": [
    {"key": "email", "lands": 1, "knows": "Office and pledge on file; start date prefilled"},
    {"key": "signin", "lands": 1, "knows": "Account, no call with our team yet"}
  ],
  "steps": [
    {"n": 1, "kind": "ask", "label": "Confirm office", "screen": "Which office did you win, Sarah?"},
    {"n": 2, "kind": "commit", "label": "Keep the pledge", "screen": "Will you keep the pledge you took in Win?"},
    {"n": 3, "kind": "land", "label": "Meet Chief of Staff", "screen": "Good to meet you, Sarah"}
  ],
  "branches": [
    {"from": 1, "kind": "ask", "label": "Can't find my office", "result": "Types it in; Jared checks it while she keeps going", "rejoins": 2}
  ]
}
```

- `id`: a letter, A onward, in the order the options appear. Close-to-today options
  come first.
- `name`: "<letter> · <two or three words>".
- `short`: the option's one-line description. 15 words at most, concrete, about what
  the user experiences. No adjectives like "seamless".
- `layout`: `close` if it follows today's app patterns (shell, top bar, cards,
  forms), `new` if the layout itself is a different paradigm.
- `family`: one or two words naming the model: Form, Review sheet, Conversation,
  Human-led, Calendar, Checklist, Invitation, Letter, Agent workspace, Search.
- `landName`: what the last step is called in the legend (for example the agent the
  flow hands off to). Optional.
- `entries`: only the doors this option supports. `lands` is the step the board
  really opens on for that door. `knows` is what we already know about the user at
  that door, in one short line, because it changes what they have to answer.
- `steps`: the main path, 4 to 9 steps. Merge screens that are one decision. `kind`
  is `ask` (they answer), `commit` (a deliberate commitment), `value` (they get
  something useful), `info` (they read or approve) or `land` (where it ends).
  `label` is 2 to 5 words. `screen` is the screen's real heading, copied from the
  board.
- `branches`: the 2 to 5 ways off the main path that matter most (not sure, wrong
  item, not now, talk to a person, still pending). `rejoins` is the step it returns
  to, or null, in which case `result` says where it ends.

**A flow must match its wireframe exactly:** the same steps in the same order, the
same headings, the same branches and the same ways in. When they disagree, fix
whichever is wrong.

## Start states

Every option board opens in the right state for each door it supports when its URL
hash is `#from=<key>`: the right step, the right things prefilled or blank, the
right ways back. With no hash it opens on its default start. Read the hash in the
constructor (`typeof location !== 'undefined' ? location.hash : ''`), set the initial
state from it, and make Restart return to that state.

## Entry boards (E-*.dc.html)

One per door, hand-built, all on the Options page above the options. Each shows
only:

1. The door's name as the title ("Emailed link from candidate success").
2. **What we know about them:** what can be prefilled, and what isn't known yet.
3. **Current**, then **Proposed**, side by side: what the user sees at that door
   today (built from the code, with the real copy) and what it would change to.

Nothing else. No code walkthrough and no list of options: the flows already link
each door to the options that support it.
