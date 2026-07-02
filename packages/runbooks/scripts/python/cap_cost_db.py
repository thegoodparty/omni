#!/usr/bin/env python3
"""Prod gp-api DB connection for the CAP cost-analysis module.

Pulls the prod DB password from AWS Secrets Manager secret `GP_API_PROD`
(same source the bulk-briefing-cohort skill uses) and opens a pg8000
connection to the prod Aurora cluster. pg8000 is pure-Python so the uv env
needs no system libpq.

AWS auth: the caller exports SSO creds first, e.g.
  eval "$(aws --profile gp-admin configure export-credentials --format env)"
  unset AWS_PROFILE          # else boto3 re-resolves the SSO profile in-process and fails
  export AWS_REGION=us-west-2

Read-only by design — this module only ever SELECTs from experiment_run and
friends. It never writes prod.
"""
from __future__ import annotations

import json
import os

import boto3
import pandas as pd
import pg8000.native

PROD_SECRET_ID = "GP_API_PROD"
PROD_DB_HOST = "gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com"
PROD_DB_NAME = "gpdb"
PROD_DB_USER = "gpuser"

# Default to prod (the invoice-validated source). Override BOTH together via
# CAP_COST_DB_SECRET_ID + CAP_COST_DB_HOST to point at a non-prod env (e.g. dev
# cohort cost validation): CAP_COST_DB_SECRET_ID=GP_API_DEV
# CAP_COST_DB_HOST=gp-api-db.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com
DB_SECRET_ID = os.environ.get("CAP_COST_DB_SECRET_ID", PROD_SECRET_ID)
DB_HOST = os.environ.get("CAP_COST_DB_HOST", PROD_DB_HOST)


def _prod_db_password() -> str:
    region = os.environ.get("AWS_REGION", "us-west-2")
    sm = boto3.client("secretsmanager", region_name=region)
    raw = sm.get_secret_value(SecretId=DB_SECRET_ID)["SecretString"]
    secret = json.loads(raw)
    return secret["DB_PASSWORD"]


def connect() -> pg8000.native.Connection:
    """Open a read-only connection (prod by default; see DB_SECRET_ID/DB_HOST)."""
    conn = pg8000.native.Connection(
        user=PROD_DB_USER,
        password=_prod_db_password(),
        host=DB_HOST,
        database=PROD_DB_NAME,
        port=5432,
        ssl_context=True,
    )
    conn.run("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    return conn


def query(sql: str, **params) -> pd.DataFrame:
    """Run a parameterized SELECT and return a DataFrame.

    pg8000.native uses :name placeholders, e.g.
      query("SELECT * FROM experiment_run WHERE \"experimentType\" = :t", t="meeting_briefing")
    """
    conn = connect()
    try:
        rows = conn.run(sql, **params)
        cols = [c["name"] for c in conn.columns]
        return pd.DataFrame(rows, columns=cols)
    finally:
        conn.close()


if __name__ == "__main__":
    import sys

    sql = sys.argv[1] if len(sys.argv) > 1 else 'SELECT count(*) AS n FROM experiment_run'
    first_keyword = sql.lstrip().split()[0].upper() if sql.lstrip() else ""
    if first_keyword not in ("SELECT", "WITH", "EXPLAIN"):
        raise SystemExit(f"cap_cost_db: only SELECT/WITH/EXPLAIN queries allowed, got '{first_keyword}'")
    print(query(sql).to_string())
