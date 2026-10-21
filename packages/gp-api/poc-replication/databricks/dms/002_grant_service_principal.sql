-- Grants for the Zerobus writer service principal. Run by the schema owner or
-- a workspace admin after the service principal exists. Replace
-- <application-id> with the service principal's Application ID (its OAuth
-- client id). The SP also needs the Workspace access entitlement.

GRANT USE CATALOG ON CATALOG goodparty_data_catalog TO `<application-id>`;
GRANT USE SCHEMA ON SCHEMA goodparty_data_catalog.gp_api_mirror_dms TO `<application-id>`;
GRANT SELECT, MODIFY ON TABLE goodparty_data_catalog.gp_api_mirror_dms.dms_cdc_change TO `<application-id>`;
