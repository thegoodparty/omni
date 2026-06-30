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


def _prod_db_password() -> str:
    region = os.environ.get("AWS_REGION", "us-west-2")
    sm = boto3.client("secretsmanager", region_name=region)
    raw = sm.get_secret_value(SecretId=PROD_SECRET_ID)["SecretString"]
    secret = json.loads(raw)
    return secret["DB_PASSWORD"]


def connect() -> pg8000.native.Connection:
    """Open a read-only prod connection. Caller closes it."""
    return pg8000.native.Connection(
        user=PROD_DB_USER,
        password=_prod_db_password(),
        host=PROD_DB_HOST,
        database=PROD_DB_NAME,
        port=5432,
    )


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
    print(query(sql).to_string())
