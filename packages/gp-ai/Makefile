.PHONY: help lint format type-check check test install-hooks uninstall-hooks

# Single source of truth for which suites run. CI (.github/workflows/gp-ai.yml)
# invokes `make test`, so the two cannot drift. There is no repo-root tests/;
# bare `pytest` would also sweep script-style dirs that ship no runnable suite.
TEST_PATHS := broker/tests pmf_engine/tests shared/tests serve/v1_pipeline/tests \
              clickup_bot/tests engineer_agent/tests campaign_plan_lambda/tests

help:
	@echo "Available commands:"
	@echo "  make install-hooks    - Install pre-commit hooks"
	@echo "  make uninstall-hooks  - Uninstall pre-commit hooks"
	@echo "  make lint             - Run ruff linter"
	@echo "  make format           - Run ruff formatter"
	@echo "  make type-check       - Run mypy type checker"
	@echo "  make check            - Run all checks (lint + format + type)"
	@echo "  make test             - Run pytest tests"

install-hooks:
	uv add --dev pre-commit
	uv run pre-commit install
	@echo "✅ Pre-commit hooks installed"

# --git-common-dir, not a literal .git/: this package sits inside omni, so the
# git dir is at the repo root, and in a worktree .git is a file, not a dir.
uninstall-hooks:
	@if [ -f "$$(git rev-parse --git-common-dir)/hooks/pre-commit" ]; then \
		uv run pre-commit uninstall; \
		echo "✅ Pre-commit hooks uninstalled"; \
	else \
		echo "ℹ️  No pre-commit hooks installed"; \
	fi

lint:
	@echo "🔍 Running ruff linter..."
	uv run ruff check .

format:
	@echo "🎨 Running ruff formatter..."
	uv run ruff format .

type-check:
	@echo "🔎 Running mypy type checker..."
	uv run mypy serve/v1_pipeline/ shared/ || true

check: lint format type-check
	@echo "✅ All checks complete"

test:
	@echo "🧪 Running tests..."
	uv run pytest $(TEST_PATHS)
