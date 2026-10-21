-- POC (import contacts): synthetic stand-in for the vendor people table, so
-- matching and review show only made-up people. Same columns as the vendor
-- table, no vendor rows. Run in Databricks SQL, then set
-- POC_IMPORT_CONTACTS_VENDOR_TABLE=goodparty_data_catalog.poc_import_contacts_synthetic.vendor_people

CREATE SCHEMA IF NOT EXISTS goodparty_data_catalog.poc_import_contacts_synthetic COMMENT 'POC import contacts: synthetic stand-in for the vendor people table. Synthetic people only.';
CREATE OR REPLACE TABLE goodparty_data_catalog.poc_import_contacts_synthetic.vendor_people AS SELECT * FROM goodparty_data_catalog.mart_gp_api.gp_api_constituents LIMIT 0;
INSERT INTO goodparty_data_catalog.poc_import_contacts_synthetic.vendor_people (id, State, City, FirstName, LastName, Residence_Addresses_AddressLine, Residence_Addresses_City, Residence_Addresses_State, Residence_Addresses_Zip, VoterTelephones_CellPhoneFormatted, Age, Age_Int) VALUES
('5e7e0000-0000-4000-8000-000000000001', 'MI', 'HOUGHTON CITY', 'WILHELMINA', 'ZZYZXTEST', '201 Fake Test Ave', 'HOUGHTON', 'MI', '49931', '(906) 555-0201', '61', 61),
('5e7e0000-0000-4000-8000-000000000002', 'MI', 'HOUGHTON CITY', 'Bartholomew', 'Zzyzxtest', '202 Fake Test Ave', 'HOUGHTON', 'MI', '49931', '(906) 555-0202', '34', 34),
('5e7e0000-0000-4000-8000-000000000003', 'MI', 'HOUGHTON CITY', 'Bartholomew', 'Zzyzxtest', '950 Pretend Rd', 'HOUGHTON', 'MI', '49931', NULL, '72', 72),
('5e7e0000-0000-4000-8000-000000000004', 'MI', 'HOUGHTON CITY', 'Petunia', 'Quaxlemock', '203 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '29', 29),
('5e7e0000-0000-4000-8000-000000000005', 'MI', 'HOUGHTON CITY', 'Petunia', 'Quaxlemock', '777 Sample Ln', 'HOUGHTON', 'MI', '49931', '(906) 555-0205', '48', 48),
('5e7e0000-0000-4000-8000-000000000006', 'MI', 'HOUGHTON CITY', 'Petunia', 'Quaxlemock', '12 Mock Blvd', 'HOUGHTON', 'MI', '49931', NULL, '83', 83),
('5e7e0000-0000-4000-8000-000000000007', 'MI', 'HOUGHTON CITY', 'Ignatius', 'Quaxlemock', '204 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '55', 55),
('5e7e0000-0000-4000-8000-000000000008', 'MI', 'HOUGHTON CITY', 'Ignatius', 'Quaxlemock', '31 Imaginary Ct', 'HOUGHTON', 'MI', '49931', NULL, '19', 19),
('5e7e0000-0000-4000-8000-000000000009', 'MI', 'HOUGHTON CITY', 'Cornelius', 'Fakerson', '205 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '40', 40),
('5e7e0000-0000-4000-8000-000000000010', 'MI', 'HOUGHTON CITY', 'Cornelius', 'Fakerson', '88 Notreal St', 'HOUGHTON', 'MI', '49931', NULL, '66', 66),
('5e7e0000-0000-4000-8000-000000000011', 'MI', 'HOUGHTON CITY', 'Dorothea', 'Placeholderson', '206 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '37', 37),
('5e7e0000-0000-4000-8000-000000000012', 'MI', 'HOUGHTON CITY', 'Dorothea', 'Placeholderson', '4 Example Way', 'HOUGHTON', 'MI', '49931', NULL, '58', 58),
('5e7e0000-0000-4000-8000-000000000013', 'MI', 'HOUGHTON CITY', 'Ezekiel', 'Mockingbird', '207 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '44', 44),
('5e7e0000-0000-4000-8000-000000000014', 'MI', 'HOUGHTON CITY', 'Ezekiel', 'Mockingbird', '600 Synthetic Dr', 'HOUGHTON', 'MI', '49931', NULL, '27', 27),
('5e7e0000-0000-4000-8000-000000000015', 'MI', 'HOUGHTON CITY', 'MARYANN', 'ZZYZXTEST', '208 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '50', 50),
('5e7e0000-0000-4000-8000-000000000016', 'MI', 'HANCOCK CITY', 'Orrin', 'Zzyzxtest', '9 Elsewhere Rd', 'HANCOCK', 'MI', '49930', NULL, '63', 63),
('5e7e0000-0000-4000-8000-000000000017', 'MI', 'HOUGHTON CITY', 'Gertrude', 'Samplewell', '209 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '71', 71),
('5e7e0000-0000-4000-8000-000000000018', 'MI', 'HOUGHTON CITY', 'Horatio', 'Fauxman', '210 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '24', 24),
('5e7e0000-0000-4000-8000-000000000019', 'MI', 'HOUGHTON CITY', 'Philippa', 'Dummyton', '211 Fake Test Ave', 'HOUGHTON', 'MI', '49931', NULL, '39', 39);
