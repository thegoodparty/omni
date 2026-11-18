"""The nightly case scout's Publisher. gp-api reads the night's chats and
drafts fictional judge cases (packages/gp-api/src/caseScout); this package is
the Lambda that opens the PR, because only it holds the GitHub App key.
"""
