import os
import sys
import pandas as pd
from databricks.sql import connect
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


def execute_query(query: str) -> pd.DataFrame:
    conn = connect(
        server_hostname=os.environ['DATABRICKS_SERVER_HOSTNAME'],
        http_path=os.environ['DATABRICKS_HTTP_PATH'],
        access_token=os.environ['DATABRICKS_API_KEY'],
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute(query)
            columns = [desc[0] for desc in cursor.description]
            return pd.DataFrame(cursor.fetchall(), columns=columns)
    finally:
        conn.close()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: uv run databricks_query.py "SELECT ..."')
        sys.exit(1)
    print(execute_query(sys.argv[1]).to_string())
