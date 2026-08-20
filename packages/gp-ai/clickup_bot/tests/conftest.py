import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lambda"))

# ci_triage.py sits beside lambda/ rather than inside it, because it runs in
# GitHub Actions (see .github/workflows/gpbot-ci-drive.yml) and never in the
# Lambda. Terraform zips lambda/handler.py by name, so the two cannot merge:
# anything the drive needs must reach it through the Lambda's event payload.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
