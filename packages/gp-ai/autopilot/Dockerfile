# Build context is packages/gp-ai (same as engineer_agent/Dockerfile), PLUS a
# named additional context "runbooks" pointing at packages/runbooks, since this
# is the first gp-ai image that also needs to bake in commands/agents from a
# sibling package. Build locally from packages/gp-ai — every path below is
# relative to that cwd, matching how this file was actually built and
# verified:
#
#   docker buildx build --build-context runbooks=../runbooks \
#     -f autopilot/Dockerfile \
#     --build-arg INSTALL_PLAYWRIGHT=false \
#     -t autopilot-agent .
#
# Requires a buildx-capable builder (the plain legacy `docker build` does not
# understand --build-context). CI already sets up docker/setup-buildx-action
# for gp-ai; wiring this image in needs one extra `build-contexts` input
# alongside the existing `context: packages/gp-ai` — since actions/checkout
# puts CI's cwd at the repo root (not packages/gp-ai), that line reads
# `build-contexts: runbooks=packages/runbooks`, repo-root-relative rather than
# the packages/gp-ai-relative `../runbooks` used above. See gp-ai.yml's build
# job (task 13).

# Stage 1: Builder
FROM python:3.12-slim AS builder

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install git for cloning repos
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY uv.lock ./
COPY pyproject.toml ./
COPY shared/pyproject.toml ./shared/
COPY autopilot/pyproject.toml ./autopilot/

# Copy source code
COPY shared/ ./shared/
COPY autopilot/ ./autopilot/

# Install dependencies for this package only
RUN uv sync --frozen --no-dev --package gp-autopilot

# Stage 2: Runtime
FROM python:3.12-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    curl \
    unzip \
    ca-certificates \
    xz-utils \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js via official binary (avoids python3 dependency issues)
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then NODE_ARCH="x64"; \
    elif [ "$ARCH" = "aarch64" ]; then NODE_ARCH="arm64"; fi && \
    curl -fsSL "https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-${NODE_ARCH}.tar.xz" -o node.tar.xz && \
    tar -xJf node.tar.xz -C /usr/local --strip-components=1 && \
    rm node.tar.xz

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Install AWS CLI (multi-arch)
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"; \
    elif [ "$ARCH" = "aarch64" ]; then \
        curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"; \
    fi && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws

# Install GitHub CLI (multi-arch)
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then GH_ARCH="amd64"; \
    elif [ "$ARCH" = "aarch64" ]; then GH_ARCH="arm64"; fi && \
    curl -sL "https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_linux_${GH_ARCH}.tar.gz" | tar xz && \
    mv gh_2.63.2_linux_${GH_ARCH}/bin/gh /usr/local/bin/ && \
    rm -rf gh_2.63.2_linux_${GH_ARCH}

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy source code
COPY --from=builder /app/shared /app/shared
COPY --from=builder /app/autopilot /app/autopilot

# Create non-root user (Claude CLI refuses to run as root with bypassPermissions)
RUN useradd -m -s /bin/bash agent && \
    mkdir -p /workspace /home/agent/.ssh /home/agent/.aws && \
    chown -R agent:agent /workspace /home/agent /app

# Configure git for the agent user
RUN git config --system user.email "gp-bot@goodparty.org" && \
    git config --system user.name "GP Bot"

# Bake a runbooks checkout into the image (the "runbooks" named build context,
# see header comment) so the commands' resolve-runbooks-dir preamble finds a
# real repo at $RUNBOOKS_DIR. This is a point-in-time copy, not a live clone —
# unlike ops/delegate/worker, which clones omni fresh on every boot (see
# packages/runbooks/AGENTS.md "Used by the delegate worker"), an autopilot
# image only picks up runbooks changes on its next image build. Repo-scoped
# skills (e.g. /ship-pr) need no separate step: they arrive with the runtime
# omni clone workspace.clone_omni makes at container start.
COPY --from=runbooks . /opt/runbooks
ENV RUNBOOKS_DIR="/opt/runbooks"

# install.sh's default destination is $CLAUDE_CONFIG_DIR, falling back to
# $HOME/.claude only if unset — this RUN executes as root (before `USER
# agent` below), so $HOME here is /root, not /home/agent. CLAUDE_CONFIG_DIR
# must be set explicitly so commands/agents land where the agent user (and
# Claude CLI, run as that user at container start) will actually look.
ENV CLAUDE_CONFIG_DIR="/home/agent/.claude"
RUN /opt/runbooks/install.sh copy user && \
    chown -R agent:agent "$CLAUDE_CONFIG_DIR"

# ARG, not ENV: only needs to affect this build's layers, never the running
# container's environment.
ARG INSTALL_PLAYWRIGHT=false

# Fixed, non-HOME-relative browsers path: this RUN executes as root (before
# `USER agent`), so Playwright's default $HOME/.cache/ms-playwright would
# land the download under /root, unreadable to the agent user the qa stage
# actually runs as. Set before the install so the download itself goes here,
# and left in ENV so the Playwright MCP process (run as agent, at container
# start) resolves the same path instead of looking under /home/agent.
ENV PLAYWRIGHT_BROWSERS_PATH="/opt/ms-playwright"

# Kept LAST (after every base layer above) so an image built with
# INSTALL_PLAYWRIGHT=false never pays for — or invalidates the cache of —
# this layer, and the two variants keep sharing every earlier layer.
#
# `npx playwright@latest`, not a pinned version: matches this repo's existing
# Playwright MCP entry in .mcp.json (`@playwright/mcp@latest`) — pinning our
# own version here could drift out of sync with whatever the MCP server
# itself resolves to and bundles at run time.
RUN if [ "$INSTALL_PLAYWRIGHT" = "true" ]; then \
        npx -y playwright@latest install --with-deps chromium && \
        chown -R agent:agent "$PLAYWRIGHT_BROWSERS_PATH"; \
    fi

# Set environment
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"
ENV PYTHONUNBUFFERED=1
ENV WORKSPACE_DIR="/workspace"
ENV HOME="/home/agent"

# Switch to non-root user
USER agent
WORKDIR /workspace

# Mirrors engineer_agent/entrypoint.sh's actual invocation (a bare `python -m
# <package>.agent.main`, not `uv run ...`): the venv is already baked and PATH
# above already points into it, so nothing at container start needs `uv` to
# re-resolve the workspace project.
ENTRYPOINT ["python", "-m", "autopilot.agent.main"]
