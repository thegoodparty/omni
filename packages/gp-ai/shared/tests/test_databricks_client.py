from unittest.mock import MagicMock, patch

from shared.databricks_client import DatabricksClient


def _client() -> DatabricksClient:
    with patch.dict(
        "os.environ",
        {"DATABRICKS_SERVER_HOSTNAME": "h", "DATABRICKS_HTTP_PATH": "p", "DATABRICKS_API_KEY": "k"},
    ):
        return DatabricksClient()


def _with_cursor(client: DatabricksClient, cursor: MagicMock) -> None:
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor
    client.connection = connection


class TestExecuteQueryWithNoResultSet:
    """`cursor.description` is None for any statement returning no rows -- DDL,
    and anything else non-SELECT. Iterating it raises TypeError, so a
    `create table` would succeed and then be reported as a query failure.
    """

    def test_a_statement_with_no_result_set_returns_an_empty_frame(self) -> None:
        cursor = MagicMock()
        cursor.description = None
        client = _client()
        _with_cursor(client, cursor)

        result = client.execute_query("create table if not exists t (a int)")

        assert result.empty
        cursor.execute.assert_called_once_with("create table if not exists t (a int)")

    def test_a_select_still_returns_its_rows(self) -> None:
        cursor = MagicMock()
        cursor.description = [("a",), ("b",)]
        cursor.fetchall.return_value = [(1, 2)]
        client = _client()
        _with_cursor(client, cursor)

        result = client.execute_query("select a, b from t")

        assert list(result.columns) == ["a", "b"]
        assert result.iloc[0].tolist() == [1, 2]
