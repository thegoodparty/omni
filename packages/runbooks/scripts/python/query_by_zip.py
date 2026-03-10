import sys
from databricks_query import execute_query

if len(sys.argv) < 3:
    print('Usage: uv run query_by_zip.py CITY_NAME STATE_CODE')
    print('Example: uv run query_by_zip.py CHARLOTTE nc')
    sys.exit(1)

city_name = sys.argv[1].upper()
state_code = sys.argv[2].lower()

result = execute_query(f'''
    SELECT
        u.Residence_Addresses_Zip as zip,
        COUNT(*) as voter_count,
        AVG(CAST(s.hs_affordable_housing_gov_has_role AS DOUBLE)) as housing_gov_role,
        AVG(CAST(s.hs_most_important_policy_item_crime AS DOUBLE)) as crime_priority,
        AVG(CAST(s.hs_most_important_policy_item_infrastructure AS DOUBLE)) as infrastructure_priority,
        AVG(CAST(s.hs_most_important_policy_item_environment AS DOUBLE)) as env_priority
    FROM goodparty_data_catalog.dbt.stg_dbt_source__l2_s3_{state_code}_uniform u
    JOIN goodparty_data_catalog.dbt.stg_dbt_source__l2_s3_{state_code}_haystaq_dna_scores s
      ON u.LALVOTERID = s.LALVOTERID
    WHERE UPPER(u.Residence_Addresses_City) = "{city_name}"
    GROUP BY u.Residence_Addresses_Zip
    ORDER BY voter_count DESC
''')

print(result.to_string())
