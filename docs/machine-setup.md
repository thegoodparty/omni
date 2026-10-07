# From a new machine to a running stack

One-time machine setup, then one command. Each prerequisite has a check —
if the check passes, skip its install step and move on.

Steps 1–6 are for a Mac. On Windows, follow [Windows](#windows) instead.

## 1. Apple's developer tools (gives you git)

Check: `xcode-select -p` (prints a path = installed)

Install: `xcode-select --install`, click Install in the popup, wait for it
to finish.

## 2. Homebrew

Check: `brew --version`

Install:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

When it finishes it prints a "Next steps" section with two commands
(`echo ... >> ~/.zprofile` and `eval ...`) — run those too, then open a
new terminal tab. Skipping them is the most common way setup breaks.

## 3. GitHub CLI, signed in

Check: `gh auth status` (says "Logged in to github.com" = done)

Install:

```bash
brew install gh
gh auth login
```

Pick: GitHub.com → HTTPS → Yes (authenticate Git) → Login with a web
browser. Use the account that's a member of the thegoodparty org.

## 4. nvm (installs the right Node for you)

Check: `nvm --version`

Install:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Then open a new terminal tab (nvm loads on shell start).

## 5. Docker Desktop

Check: `docker info` (prints server info = running)

Install:

```bash
brew install --cask docker
open -a Docker
```

First launch asks you to accept the agreement and for your Mac password;
"Skip" the Docker sign-in. You're done when the whale icon in the menu
bar stops animating. Docker must be running whenever you run setup.

## 6. Clone and run

First `cd` into whatever folder you keep projects in (for example
`cd ~/code` — your choice), then:

```bash
gh repo clone thegoodparty/omni -- --recurse-submodules
cd omni
nvm install
npm run setup
```

Setup walks you through a GitHub sign-in in the browser (enter the code
it shows), then takes 15–25 minutes on first run. It ends with a summary
that includes a URL, email, and password — that's your local login at
http://localhost:4000.

Re-running `npm run setup` (from your omni folder) any time is safe: it
skips what's already done and asks before touching your local database.

## Windows

Run every command below in **Git Bash** unless the step says PowerShell.
Setup is a bash script, and from PowerShell `bash` resolves to WSL's
`bash.exe`, not Git's.

### W1. Git for Windows (gives you Git Bash)

Check: Git Bash is in the Start menu.

Install (PowerShell): `winget install -e --id Git.Git`, then open Git Bash
from the Start menu.

### W2. GitHub CLI, signed in

Check: `gh auth status` (says "Logged in to github.com" = done)

Install: `winget install -e --id GitHub.cli`, open a new Git Bash window,
then `gh auth login` with the same choices as step 3 above.

### W3. fnm (installs the right Node for you)

Check: `fnm --version`

Install:

```bash
winget install -e --id Schniz.fnm
echo 'eval "$(fnm env --use-on-cd --shell bash)"' >> ~/.bashrc
```

Then open a new Git Bash window and run `fnm --version`. On a fresh Git
install, that window first prints a red "WARNING: Found ~/.bashrc but no
~/.bash_profile". That's expected: Git creates a `~/.bash_profile` that
loads `~/.bashrc`. If `fnm` is still not found, your existing
`~/.bash_profile` doesn't load `~/.bashrc`; add
`test -f ~/.bashrc && . ~/.bashrc` to it. fnm reads `.nvmrc` the way nvm
does.

### W4. WSL2 and Docker Desktop

Check: `docker info` (prints server info = running)

Install, in PowerShell opened with "Run as administrator":

```powershell
wsl --install --no-distribution
```

Restart the computer (the output says so near the end), then in an
administrator PowerShell again:

```powershell
winget install -e --id Docker.DockerDesktop
```

Open Docker Desktop from the Start menu, accept the agreement, and skip
the Docker sign-in. You're done when the bottom-left corner says "Engine
running". If it reports a WSL error instead, run `wsl --update` and
reopen it. Docker must be running whenever you run setup.

### W5. Clone and run

In Git Bash, `cd` into whatever folder you keep projects in, then:

```bash
gh repo clone thegoodparty/omni -- --recurse-submodules
cd omni
fnm install
npm run setup
```

The clone warns that `Art.png` and `art.png` under
`packages/gp-webapp/public/images/homepage/` collided; that's harmless.
From here setup behaves as in step 6.

## If something fails

- "docker daemon not reachable" → Docker Desktop isn't running; see step 5.
- "rejected the GitHub token (401)" → re-run `npm run setup` for a fresh
  device-flow sign-in.
- "refused the request (403)" → your GitHub account isn't an active
  thegoodparty org member — ask an org admin.
- Node version errors → from your omni folder, run `nvm install` (on
  Windows, `fnm install`), open a new terminal, retry.
- "execvpe(/bin/bash) failed" (Windows) → you ran setup from PowerShell or
  cmd; run it from Git Bash.
- "Prisma Migrate detected that it was invoked by Claude Code" (or another
  AI agent) → Prisma refuses the local DB reset unless a person runs it.
  Run `npm run setup` yourself in a terminal; it resumes where it stopped.
- Anything else: paste the last ~20 lines of output to an engineer or a
  Claude session in the repo.

Day-to-day details, the `--from` escape hatch, and how setup works:
[`docs/development.md`](./development.md).
