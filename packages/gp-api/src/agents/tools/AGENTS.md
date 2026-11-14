# Agent tools

Engine-agnostic tools for agents in the registry (`AgentTool`, `tool.ts`). Each engine adapts `AgentTool` to its own format; the tools themselves never import an engine.

| Tool             | File                | What it does                                                                                                                                             |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `webSearch`      | `webSearch.ts`      | Anthropic's server-side web search. Has no `execute`: engines check `isProviderWebSearch` and register it with `aiSdkWebSearch` or `langChainWebSearch`. |
| `fetchPage`      | `fetchPage.ts`      | A page as markdown with absolute links, 24k characters per call, `offset` to read on. A PDF or Word file returns its page count and first page.          |
| `checkLink`      | `checkLink.ts`      | Status and final URL (HEAD, GET when HEAD is refused).                                                                                                   |
| `readDocument`   | `readDocument.ts`   | PDF or Word text, up to 20 pages per call (`pages: "5-12"`).                                                                                             |
| `searchDocument` | `searchDocument.ts` | Literal, case-insensitive matches with page numbers. `a                                                                                                  | b` for alternatives. Never a regex. |
| `browserTools`   | `browserTools.ts`   | Opt-in. Playwright MCP's navigate, snapshot, click, type, select, press key and wait, served in-process.                                                 |

## How a fetch resolves (`agentWeb.service.ts`)

1. Judge replay, when the run is bound (`AgentPageReplayService`, `judgeReplay.ts`): the broker's recordings in `gp-agent-artifacts-dev`, matched by the broker's normalized-URL hash. A miss fetches live.
2. Plain HTTP behind gp-api's SSRF guard (`webHttp.ts`), up to 100 MB.
3. The run's remote browser (`agentBrowser.service.ts`) when the page needs JavaScript or the site refuses plain clients (`needsBrowser`, `webText.ts`). A response the browser would download is taken off the wire over CDP and returned as bytes.

Parsed documents and fetched pages are cached per run, so paging and searching don't refetch.

PDF and Word parsing (`pdf-parse`, `mammoth`) runs in one worker thread per process (`documentParse.worker.ts`, started from `documentPages` in `webText.ts`); parses queue for it, one at a time. The per-run cache of parsed text stays in the main thread. Under tsx and vitest the worker is loaded through tsx.

## The browser

One AgentCore Browser session per run (`agentCoreBrowser.ts`), driven by Playwright `connectOverCDP`; gp-api runs no Chromium. Set `AGENT_BROWSER_CDP_URL` to a local Chromium's CDP endpoint to work without AWS. IAM is the task role statement in `deploy/index.ts` (dev and preview).

## What engines must do

- Call `AgentWebService.endRun(runId)` when a run ends. It stops the browser session and drops the run's caches. A run that dies without it is closed after ten idle minutes.
- For a judge run, call `AgentPageReplayService.bind(runId, judgeReplay)` before the first step and `release(runId)` at the end.
- Tools resolve their services through `ctx.moduleRef`; `AgentsModule` imports `AgentToolsModule`, so a runtime provided there can inject `AgentWebService` and `AgentPageReplayService` directly.

## Proving it

`scripts/agent-web-tools-live.ts` runs every tool against a live CivicWeb meeting page and its packet. `agentBrowser.service.test.ts` drives a real Chromium over CDP and skips where none is installed.
