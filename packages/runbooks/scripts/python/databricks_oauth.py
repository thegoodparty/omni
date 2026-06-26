"""Profile-based (OAuth) Databricks connection for the event-health monitor.

Provides ``run_query(sql) -> pandas.DataFrame``. Auth is resolved by the Databricks
SDK ``Config`` via ``credentials_provider`` — no personal access token. If the SDK
``Config`` carries a service-principal ``client_id`` / ``client_secret`` (e.g. CI) it
uses OAuth M2M; otherwise it uses the ``~/.databrickscfg`` CLI / SDK default profile
(``databricks auth login``, honoring ``DATABRICKS_CONFIG_PROFILE``).

This is the OAuth counterpart to the PAT-based ``databricks_query.py`` used by the
provenance backfill. The event-health monitor uses OAuth (the analytics standard);
the backfill keeps its PAT path untouched. The SQL warehouse comes from
``DATABRICKS_HTTP_PATH`` (``/sql/1.0/warehouses/<id>``), read from ``scripts/.env``
to match the package convention.

Ported from gp-data-platform ``analytics/lib/databricks_conn.py`` (DATA-1952).

Usage:
    import databricks_oauth as dbc
    df = dbc.run_query("select 1")
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable, Sequence
from typing import Any

import pandas as pd
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def _server_hostname(host: str | None) -> str:
    """Return the bare ``server_hostname`` the sql-connector expects (no scheme/slash)."""
    if not host:
        raise ValueError("Databricks profile resolved an empty host. Run `databricks auth login`.")
    return host.removeprefix("https://").removeprefix("http://").rstrip("/")


def _build_connect_kwargs(config: Any, http_path: str, *, oauth_m2m: Callable[[Any], Any]) -> dict:
    """Return kwargs for ``databricks_sql.connect()``.

    Scheme-stripped host, the SQL warehouse ``http_path``, and a ``credentials_provider``
    chosen by auth mode: OAuth M2M with a service-principal ``client_id`` /
    ``client_secret``, otherwise the SDK default (``~/.databrickscfg`` profile).
    """
    if not http_path:
        raise ValueError("DATABRICKS_HTTP_PATH is not set (expected /sql/1.0/warehouses/<id>).")

    if config.client_id and config.client_secret:

        def credentials():
            return oauth_m2m(config)
    else:

        def credentials():
            return config.authenticate

    return {
        "server_hostname": _server_hostname(config.host),
        "http_path": http_path,
        "credentials_provider": credentials,
    }


def _connect_with_retry(
    connect_fn: Callable[..., Any],
    kwargs: dict,
    *,
    max_retries: int = 5,
    retry_delay: int = 10,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> Any:
    """Open a connection, retrying to absorb SQL-warehouse cold start."""
    for attempt in range(max_retries):
        try:
            return connect_fn(**kwargs)
        except Exception:
            if attempt == max_retries - 1:
                raise
            sleep_fn(retry_delay)
    raise RuntimeError("unreachable")


def _to_dataframe(description: Sequence[Any], rows: Sequence[Any]) -> pd.DataFrame:
    columns = [col[0] for col in description]
    return pd.DataFrame(list(rows), columns=columns)


def get_connection(*, max_retries: int = 5, retry_delay: int = 10) -> Any:
    """Open an authenticated connection to the profile's SQL warehouse (OAuth)."""
    from databricks import sql as dbsql
    from databricks.sdk.core import Config, oauth_service_principal

    config = Config()
    kwargs = _build_connect_kwargs(
        config,
        os.environ.get("DATABRICKS_HTTP_PATH", ""),
        oauth_m2m=oauth_service_principal,
    )
    return _connect_with_retry(dbsql.connect, kwargs, max_retries=max_retries, retry_delay=retry_delay)


def run_query(sql: str, *, max_retries: int = 5, retry_delay: int = 10) -> pd.DataFrame:
    """Execute ``sql`` against the profile's SQL warehouse, return a DataFrame."""
    connection = get_connection(max_retries=max_retries, retry_delay=retry_delay)
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql)
            rows = cursor.fetchall()
            return _to_dataframe(cursor.description, rows)
    finally:
        connection.close()
