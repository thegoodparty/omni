# From a new Mac to a running stack

One-time machine setup, then one command. Each prerequisite has a check —
if the check passes, skip its install step and move on.

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

```bash
gh repo clone thegoodparty/omni ~/omni -- --recurse-submodules
cd ~/omni
nvm install
npm run setup
```

Setup walks you through a GitHub sign-in in the browser (enter the code
it shows), then takes 15–25 minutes on first run. It ends with a summary
that includes a URL, email, and password — that's your local login at
http://localhost:4000.

Re-running `npm run setup` any time is safe: it skips what's already
done and asks before touching your local database.

## If something fails

- "docker daemon not reachable" → Docker Desktop isn't running; see step 5.
- "rejected the GitHub token (401)" → re-run `npm run setup` for a fresh
  device-flow sign-in.
- "refused the request (403)" → your GitHub account isn't an active
  thegoodparty org member — ask an org admin.
- Node version errors → `cd ~/omni && nvm install`, open a new terminal,
  retry.
- Anything else: paste the last ~20 lines of output to an engineer or a
  Claude session in the repo.

Day-to-day details, the `--from` escape hatch, and how setup works:
[`docs/development.md`](./development.md).
