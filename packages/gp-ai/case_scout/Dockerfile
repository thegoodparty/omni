# Reader Fargate task image. Not yet wired into .github/workflows/gp-ai.yml's
# build matrix — that lands with the end-to-end wiring story (TDD M1's last
# story), which is also what first gives this module a real image tag to
# deploy. Until then this Dockerfile builds locally/in review but nothing
# pushes it.
#
# Plain two-stage build, no agent harness: unlike pmf_engine's Fargate image
# (which runs the Claude Agent SDK and needs Node + the Claude CLI), the
# Reader is an ordinary data-processing job — read Databricks, call Anthropic,
# write S3 — so it follows hubspot_ddhq_match's simpler Dockerfile shape
# instead.

# Stage 1: Builder
FROM public.ecr.aws/docker/library/python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY uv.lock ./uv.lock
COPY pyproject.toml ./pyproject.toml
COPY shared/pyproject.toml ./shared/pyproject.toml
COPY case_scout/pyproject.toml ./case_scout/pyproject.toml
COPY shared/ ./shared/
COPY case_scout/ ./case_scout/

WORKDIR /app/case_scout
RUN uv sync --frozen --no-dev --package gp-case-scout
WORKDIR /app

# Stage 2: Runtime
FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/case_scout /app/case_scout
COPY --from=builder /app/shared /app/shared

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app"
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "case_scout.reader.main"]
