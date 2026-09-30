set -euo pipefail
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "::error::ANTHROPIC_API_KEY is empty for this run, so the sweep cannot make a model call. It exists as a repository secret; a caller of this reusable workflow has to pass it through explicitly, which is the point of declaring it rather than inheriting."
  exit 1
fi
echo 'the Anthropic key is present'
