import sys
from databricks_query import execute_query

if len(sys.argv) < 3:
    print('Usage: uv run query_issue_scores.py CITY_NAME STATE_CODE')
    print('Example: uv run query_issue_scores.py CHARLOTTE nc')
    sys.exit(1)

city_name = sys.argv[1].upper()
state_code = sys.argv[2].lower()

result = execute_query(f'''
    SELECT
        COUNT(*) as voter_count,

        -- Housing & Development (LOCAL: zoning, development, affordable housing)
        AVG(CAST(s.hs_affordable_housing_gov_has_role AS DOUBLE)) as housing_gov_role,
        AVG(CAST(s.hs_most_important_policy_item_real_estate AS DOUBLE)) as housing_priority,

        -- Public Safety (LOCAL: police, fire, emergency services)
        AVG(CAST(s.hs_most_important_policy_item_crime AS DOUBLE)) as crime_priority,
        AVG(CAST(s.hs_police_reform_support AS DOUBLE)) as police_reform_support,

        -- Infrastructure & Transportation (LOCAL: roads, transit, water/sewer)
        AVG(CAST(s.hs_most_important_policy_item_infrastructure AS DOUBLE)) as infrastructure_priority,

        -- Local Environment & Sustainability (LOCAL: green initiatives, parks, recycling)
        AVG(CAST(s.hs_most_important_policy_item_environment AS DOUBLE)) as env_priority,
        AVG(CAST(s.hs_climate_change_believer AS DOUBLE)) as climate_believer,

        -- Education (LOCAL: school boards, K-12 funding - varies by state)
        AVG(CAST(s.hs_most_important_policy_item_education AS DOUBLE)) as education_priority,

        -- Local Economic Development (LOCAL: business incentives, development)
        AVG(CAST(s.hs_most_important_policy_item_economics AS DOUBLE)) as econ_priority,

        -- Local Taxes & Budget (LOCAL: property tax, local sales tax, fees)
        AVG(CAST(s.hs_most_important_policy_item_taxes AS DOUBLE)) as tax_priority,

        -- Ideology indicators (for context only)
        AVG(CAST(s.hs_ideology_general_liberal AS DOUBLE)) as ideology_liberal,
        AVG(CAST(s.hs_ideology_general_conservative AS DOUBLE)) as ideology_conservative

    FROM goodparty_data_catalog.dbt.stg_dbt_source__l2_s3_{state_code}_uniform u
    JOIN goodparty_data_catalog.dbt.stg_dbt_source__l2_s3_{state_code}_haystaq_dna_scores s
      ON u.LALVOTERID = s.LALVOTERID
    WHERE UPPER(u.Residence_Addresses_City) = "{city_name}"
''')

print(result.T.to_string())
