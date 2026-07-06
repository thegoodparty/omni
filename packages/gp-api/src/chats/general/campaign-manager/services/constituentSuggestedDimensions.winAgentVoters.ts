import type { AdvertisedDimension } from '@/llm/tools/queryConstituentData.tool'

// GENERATED — do not edit by hand.
//
// The curated set of breakdown dimensions advertised to the model for the
// Win mart: the Serve demographic / turnout / issue-score base, PLUS a
// partisan block (party registration, modeled partisanship and ideology,
// ticket-splitting, donor propensity). Unlike Serve, partisan dimensions
// are advertised: the Win mart retains them by design for campaign
// targeting (decision 2026-07-06, see
// scratch/campaign-manager/win-constituent-data-spec.md). Identity and
// religion/ethnicity proxies stay omitted. The full win_agent_voters table
// remains queryable via the validator allowlist; this only shapes what the
// agent is guided toward. Regenerate when the mart changes.
export const WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS: AdvertisedDimension[] = [
  { name: 'Voters_Age', label: 'Age in years' },
  { name: 'Voters_Gender', label: 'Gender (M/F)' },
  { name: 'ConsumerData_RUS_Code', label: 'Rural / urban / suburban' },
  {
    name: 'ConsumerData_Education_of_Person',
    label: 'Education level (modeled)',
  },
  { name: 'ConsumerData_Marital_Status', label: 'Marital status (inferred)' },
  {
    name: 'ConsumerData_Number_Of_Persons_in_HH',
    label: 'Household size (people)',
  },
  { name: 'ConsumerData_Number_Of_Adults_in_HH', label: 'Adults in household' },
  {
    name: 'ConsumerData_Number_Of_Children_in_HH',
    label: 'Children in household (count)',
  },
  {
    name: 'ConsumerData_Presence_Of_Children_in_HH',
    label: 'Has children under 18 at home',
  },
  {
    name: 'ConsumerData_Single_Parent_in_Household',
    label: 'Single-parent household',
  },
  {
    name: 'ConsumerData_Length_Of_Residence_Code',
    label: 'Years at current address',
  },
  { name: 'ConsumerData_Generations_In_HH', label: 'Generations in household' },
  { name: 'ConsumerDataLL_Veteran', label: 'Veteran' },
  { name: 'ConsumerData_Veteran_In_HH', label: 'Veteran in household' },
  {
    name: 'ConsumerData_Senior_Adult_In_HH',
    label: 'Senior adult in household',
  },
  { name: 'ConsumerData_Young_Adult_In_HH', label: 'Young adult in household' },
  { name: 'Voters_Active', label: 'Registration status (active/inactive)' },
  {
    name: 'Voters_VotingPerformanceEvenYearGeneral',
    label: 'General-election turnout (%)',
  },
  {
    name: 'Voters_VotingPerformanceEvenYearPrimary',
    label: 'Primary-election turnout (%)',
  },
  { name: 'hs_abortion_pro_choice', label: 'Abortion Pro Choice' },
  { name: 'hs_abortion_pro_life', label: 'Abortion Pro Life' },
  { name: 'hs_activism', label: 'Activism' },
  {
    name: 'hs_affordability_changed_what_you_buy_no',
    label: 'affordability changed what you buy no',
  },
  {
    name: 'hs_affordability_changed_what_you_buy_yes',
    label: 'affordability changed what you buy yes',
  },
  {
    name: 'hs_affordable_housing_gov_has_role',
    label: 'Affordable Housing Gov Has Role',
  },
  {
    name: 'hs_affordable_housing_gov_no_role',
    label: 'Affordable Housing Gov No Role',
  },
  { name: 'hs_age_limit_oppose', label: 'Age Limit Oppose' },
  { name: 'hs_age_limit_support', label: 'Age Limit Support' },
  {
    name: 'hs_aliens_governenment_disclosed_all',
    label: 'Aliens Governenment Disclosed All',
  },
  {
    name: 'hs_aliens_governenment_hiding_much',
    label: 'Aliens Governenment Hiding Much',
  },
  { name: 'hs_amazon_exploitative', label: 'Amazon Exploitative' },
  { name: 'hs_amazon_good_jobs', label: 'Amazon Good Jobs' },
  { name: 'hs_any_home_buyer', label: 'Any Home Buyer' },
  { name: 'hs_area_identity_rural', label: 'area identity rural' },
  { name: 'hs_area_identity_suburban', label: 'area identity suburban' },
  { name: 'hs_area_identity_urban', label: 'area identity urban' },
  {
    name: 'hs_artificial_intelligence_excited',
    label: 'Artificial Intelligence Excited',
  },
  { name: 'hs_autonomous_vehicles_allow', label: 'Autonomous Vehicles Allow' },
  {
    name: 'hs_autonomous_vehicles_do_not_allow',
    label: 'Autonomous Vehicles Do Not Allow',
  },
  {
    name: 'hs_campaign_finance_reform_high_priority',
    label: 'campaign finance reform high priority',
  },
  {
    name: 'hs_campaign_finance_reform_less_important',
    label: 'campaign finance reform less important',
  },
  {
    name: 'hs_candidate_mail_do_not_read',
    label: 'Candidate Mail Do Not Read',
  },
  {
    name: 'hs_candidate_mail_read_carefully',
    label: 'Candidate Mail Read Carefully',
  },
  {
    name: 'hs_candidate_mail_readership_do_not_read',
    label: 'candidate mail readership do not read',
  },
  {
    name: 'hs_candidate_mail_readership_read_carefully',
    label: 'candidate mail readership read carefully',
  },
  { name: 'hs_capitalism_believe_flawed', label: 'Capitalism Believe Flawed' },
  { name: 'hs_capitalism_believe_sound', label: 'Capitalism Believe Sound' },
  { name: 'hs_casino_oppose', label: 'Casino Oppose' },
  { name: 'hs_casino_support', label: 'Casino Support' },
  {
    name: 'hs_charity_giving_enviro_cause',
    label: 'Charity Giving Enviro Cause',
  },
  {
    name: 'hs_charity_giving_international_aid',
    label: 'Charity Giving International Aid',
  },
  {
    name: 'hs_charity_giving_performing_arts',
    label: 'Charity Giving Performing Arts',
  },
  { name: 'hs_charity_giving_vet_cause', label: 'Charity Giving Vet Cause' },
  { name: 'hs_charter_schools_oppose', label: 'Charter Schools Oppose' },
  { name: 'hs_charter_schools_support', label: 'Charter Schools Support' },
  {
    name: 'hs_china_foreign_policy_advesarial',
    label: 'China Foreign Policy Advesarial',
  },
  {
    name: 'hs_china_foreign_policy_work_with',
    label: 'China Foreign Policy Work With',
  },
  { name: 'hs_civil_liberties_oppose', label: 'Civil Liberties Oppose' },
  { name: 'hs_civil_liberties_support', label: 'Civil Liberties Support' },
  { name: 'hs_climate_change_believer', label: 'Climate Change Believer' },
  {
    name: 'hs_climate_change_nonbeliever',
    label: 'Climate Change Nonbeliever',
  },
  {
    name: 'hs_college_admissions_consider_race',
    label: 'College Admissions Consider Race',
  },
  {
    name: 'hs_college_admissions_do_not_consider_race',
    label: 'College Admissions Do Not Consider Race',
  },
  {
    name: 'hs_community_college_free_oppose',
    label: 'Community College Free Oppose',
  },
  {
    name: 'hs_community_college_free_support',
    label: 'Community College Free Support',
  },
  { name: 'hs_community_not_integrated', label: 'community not integrated' },
  { name: 'hs_community_very_integrated', label: 'community very integrated' },
  {
    name: 'hs_concerned_job_loss_due_to_ai_no',
    label: 'concerned job loss due to ai no',
  },
  {
    name: 'hs_concerned_job_loss_due_to_ai_yes',
    label: 'concerned job loss due to ai yes',
  },
  { name: 'hs_conspiracy_believer', label: 'Conspiracy Believer' },
  { name: 'hs_conspiracy_nonbeliever', label: 'Conspiracy Nonbeliever' },
  {
    name: 'hs_consumer_value_brand_savings',
    label: 'Consumer Value Brand Savings',
  },
  {
    name: 'hs_consumer_value_environment',
    label: 'Consumer Value Environment',
  },
  { name: 'hs_consumer_value_low_cost', label: 'Consumer Value Low Cost' },
  {
    name: 'hs_critical_race_theory_books_ban',
    label: 'Critical Race Theory Books Ban',
  },
  {
    name: 'hs_critical_race_theory_books_do_not_ban',
    label: 'Critical Race Theory Books Do Not Ban',
  },
  { name: 'hs_crypto_buyer_no', label: 'Crypto Buyer No' },
  { name: 'hs_crypto_buyer_yes', label: 'Crypto Buyer Yes' },
  {
    name: 'hs_crypto_increase_restrictions',
    label: 'Crypto Increase Restrictions',
  },
  { name: 'hs_crypto_reduce_leave_as_is', label: 'Crypto Reduce Leave As Is' },
  {
    name: 'hs_crypto_reduce_restrictions',
    label: 'Crypto Reduce Restrictions',
  },
  { name: 'hs_dating_optimistic', label: 'dating optimistic' },
  { name: 'hs_dating_pessimistic', label: 'dating pessimistic' },
  { name: 'hs_death_penalty_oppose', label: 'Death Penalty Oppose' },
  { name: 'hs_death_penalty_support', label: 'Death Penalty Support' },
  { name: 'hs_defense_spending_increase', label: 'Defense Spending Increase' },
  { name: 'hs_defense_spending_reduce', label: 'Defense Spending Reduce' },
  { name: 'hs_dei_oppose', label: 'Dei Oppose' },
  { name: 'hs_dei_support', label: 'Dei Support' },
  { name: 'hs_despondency_ahead', label: 'Despondency Ahead' },
  { name: 'hs_despondency_far_behind', label: 'Despondency Far Behind' },
  { name: 'hs_despondency_on_pace', label: 'Despondency On Pace' },
  { name: 'hs_doge_oppose', label: 'Doge Oppose' },
  { name: 'hs_doge_support', label: 'Doge Support' },
  {
    name: 'hs_domestic_deployment_of_troops_oppose',
    label: 'domestic deployment of troops oppose',
  },
  {
    name: 'hs_domestic_deployment_of_troops_support',
    label: 'domestic deployment of troops support',
  },
  {
    name: 'hs_dropoff_fill_entire_ballot',
    label: 'Dropoff Fill Entire Ballot',
  },
  { name: 'hs_dropoff_fill_only_top', label: 'Dropoff Fill Only Top' },
  { name: 'hs_econ_anxiety_not_worried', label: 'Econ Anxiety Not Worried' },
  { name: 'hs_econ_anxiety_very_worried', label: 'Econ Anxiety Very Worried' },
  {
    name: 'hs_economic_despondency_ahead',
    label: 'economic despondency ahead',
  },
  {
    name: 'hs_economic_despondency_far_behind',
    label: 'economic despondency far behind',
  },
  {
    name: 'hs_electric_vehicle_likely_buyer',
    label: 'Electric Vehicle Likely Buyer',
  },
  {
    name: 'hs_electric_vehicle_not_likely',
    label: 'Electric Vehicle Not Likely',
  },
  { name: 'hs_epstein_files_important', label: 'epstein files important' },
  {
    name: 'hs_epstein_files_unimportant_or_hoax',
    label: 'epstein files unimportant or hoax',
  },
  {
    name: 'hs_family_medical_leave_oppose',
    label: 'Family Medical Leave Oppose',
  },
  {
    name: 'hs_family_medical_leave_support',
    label: 'Family Medical Leave Support',
  },
  { name: 'hs_felon_voting_oppose', label: 'Felon Voting Oppose' },
  { name: 'hs_felon_voting_support', label: 'Felon Voting Support' },
  { name: 'hs_gamer_no', label: 'gamer no' },
  { name: 'hs_gamer_yes', label: 'gamer yes' },
  { name: 'hs_gas_tax_oppose', label: 'Gas Tax Oppose' },
  { name: 'hs_gas_tax_support', label: 'Gas Tax Support' },
  { name: 'hs_general_anti_vax_pro_vax', label: 'General Anti Vax Pro Vax' },
  { name: 'hs_gentrification_oppose', label: 'Gentrification Oppose' },
  { name: 'hs_gentrification_support', label: 'Gentrification Support' },
  { name: 'hs_gig_work_keep_contractor', label: 'Gig Work Keep Contractor' },
  { name: 'hs_gig_work_make_employees', label: 'Gig Work Make Employees' },
  { name: 'hs_gig_worker_ever', label: 'Gig Worker Ever' },
  { name: 'hs_gig_worker_now', label: 'Gig Worker Now' },
  { name: 'hs_gig_worker_unlikely', label: 'Gig Worker Unlikely' },
  { name: 'hs_green_new_deal_oppose', label: 'Green New Deal Oppose' },
  { name: 'hs_green_new_deal_support', label: 'Green New Deal Support' },
  { name: 'hs_gun_control_oppose', label: 'Gun Control Oppose' },
  { name: 'hs_gun_control_support', label: 'Gun Control Support' },
  { name: 'hs_ice_actions_oppose', label: 'ice actions oppose' },
  { name: 'hs_ice_actions_support', label: 'ice actions support' },
  {
    name: 'hs_illegal_imm_process_unfair',
    label: 'illegal imm process unfair',
  },
  { name: 'hs_illegal_imm_undesirable', label: 'Illegal Imm Undesirable' },
  {
    name: 'hs_immigration_process_unfair',
    label: 'Immigration Process Unfair',
  },
  { name: 'hs_immigration_undesirable', label: 'Immigration Undesirable' },
  {
    name: 'hs_income_inequality_no_issue',
    label: 'Income Inequality No Issue',
  },
  { name: 'hs_income_inequality_serious', label: 'Income Inequality Serious' },
  { name: 'hs_inflation_fault_biden', label: 'Inflation Fault Biden' },
  {
    name: 'hs_inflation_fault_corporate_america',
    label: 'Inflation Fault Corporate America',
  },
  {
    name: 'hs_inflation_fault_external_events',
    label: 'Inflation Fault External Events',
  },
  {
    name: 'hs_infrastructure_funding_enough_spent',
    label: 'Infrastructure Funding Enough Spent',
  },
  {
    name: 'hs_infrastructure_funding_fund_more',
    label: 'Infrastructure Funding Fund More',
  },
  {
    name: 'hs_insurance_of_last_resort_government_should_not_provide',
    label: 'Insurance Of Last Resort Government Should Not Provide',
  },
  {
    name: 'hs_insurance_of_last_resort_government_should_provide',
    label: 'Insurance Of Last Resort Government Should Provide',
  },
  {
    name: 'hs_israel_committing_genocide_no',
    label: 'israel committing genocide no',
  },
  {
    name: 'hs_israel_committing_genocide_yes',
    label: 'israel committing genocide yes',
  },
  {
    name: 'hs_israel_military_actions_oppose',
    label: 'Israel Military Actions Oppose',
  },
  {
    name: 'hs_israel_military_actions_support',
    label: 'Israel Military Actions Support',
  },
  { name: 'hs_jan_6th_pardons_oppose', label: 'Jan 6Th Pardons Oppose' },
  { name: 'hs_jan_6th_pardons_support', label: 'Jan 6Th Pardons Support' },
  { name: 'hs_job_seeker_does_not_work', label: 'Job Seeker Does Not Work' },
  { name: 'hs_job_seeker_likely', label: 'Job Seeker Likely' },
  { name: 'hs_job_seeker_unlikely', label: 'Job Seeker Unlikely' },
  { name: 'hs_jobs_guarantee_oppose', label: 'Jobs Guarantee Oppose' },
  { name: 'hs_jobs_guarantee_support', label: 'Jobs Guarantee Support' },
  { name: 'hs_likely_ev', label: 'Likely Ev' },
  { name: 'hs_likely_mid_term_voter', label: 'Likely Mid Term Voter' },
  { name: 'hs_likely_polling_turnout', label: 'Likely Polling Turnout' },
  { name: 'hs_likely_presidential_voter', label: 'Likely Presidential Voter' },
  { name: 'hs_likely_vbm', label: 'Likely Vbm' },
  { name: 'hs_listen_podcaster_carlson', label: 'listen podcaster carlson' },
  { name: 'hs_listen_podcaster_daily', label: 'listen podcaster daily' },
  {
    name: 'hs_listen_podcaster_left_leaning',
    label: 'listen podcaster left leaning',
  },
  { name: 'hs_listen_podcaster_meidas', label: 'listen podcaster meidas' },
  {
    name: 'hs_listen_podcaster_right_leaning',
    label: 'listen podcaster right leaning',
  },
  { name: 'hs_listen_podcaster_rogan', label: 'listen podcaster rogan' },
  { name: 'hs_marijuana_legal_oppose', label: 'Marijuana Legal Oppose' },
  { name: 'hs_marijuana_legal_support', label: 'Marijuana Legal Support' },
  { name: 'hs_mass_deporations_oppose', label: 'Mass Deporations Oppose' },
  { name: 'hs_mass_deporations_support', label: 'Mass Deporations Support' },
  { name: 'hs_medicaid_expansion_oppose', label: 'Medicaid Expansion Oppose' },
  {
    name: 'hs_medicaid_expansion_support',
    label: 'Medicaid Expansion Support',
  },
  { name: 'hs_medicare_for_all_oppose', label: 'Medicare For All Oppose' },
  { name: 'hs_medicare_for_all_support', label: 'Medicare For All Support' },
  { name: 'hs_mexican_wall_oppose', label: 'Mexican Wall Oppose' },
  { name: 'hs_mexican_wall_support', label: 'Mexican Wall Support' },
  {
    name: 'hs_military_family_relationship_no',
    label: 'Military Family Relationship No',
  },
  {
    name: 'hs_military_family_relationship_yes',
    label: 'Military Family Relationship Yes',
  },
  { name: 'hs_military_family_self', label: 'military family self' },
  {
    name: 'hs_min_wage_15_increase_oppose',
    label: 'Min Wage 15 Increase Oppose',
  },
  {
    name: 'hs_min_wage_15_increase_support',
    label: 'Min Wage 15 Increase Support',
  },
  {
    name: 'hs_most_important_policy_item_economics',
    label: 'Most Important Policy Item Economics',
  },
  {
    name: 'hs_most_important_policy_item_environment',
    label: 'Most Important Policy Item Environment',
  },
  {
    name: 'hs_most_important_policy_item_help_people',
    label: 'Most Important Policy Item Help People',
  },
  {
    name: 'hs_most_important_policy_keep_safe',
    label: 'Most Important Policy Keep Safe',
  },
  { name: 'hs_new_home_buyer', label: 'New Home Buyer' },
  { name: 'hs_news_independent', label: 'news independent' },
  { name: 'hs_news_mainstream', label: 'news mainstream' },
  { name: 'hs_obamacare_aca_expand', label: 'Obamacare Aca Expand' },
  { name: 'hs_obamacare_aca_oppose', label: 'Obamacare Aca Oppose' },
  { name: 'hs_obamacare_aca_protect', label: 'Obamacare Aca Protect' },
  {
    name: 'hs_online_gambling_less_legal',
    label: 'Online Gambling Less Legal',
  },
  {
    name: 'hs_online_gambling_more_legal',
    label: 'Online Gambling More Legal',
  },
  { name: 'hs_opioid_crisis_enforce', label: 'Opioid Crisis Enforce' },
  { name: 'hs_opioid_crisis_treat', label: 'Opioid Crisis Treat' },
  { name: 'hs_pipeline_fracking_oppose', label: 'Pipeline Fracking Oppose' },
  { name: 'hs_pipeline_fracking_support', label: 'Pipeline Fracking Support' },
  { name: 'hs_podcast_listener_no', label: 'Podcast Listener No' },
  { name: 'hs_podcast_listener_yes', label: 'Podcast Listener Yes' },
  { name: 'hs_police_trust_no', label: 'Police Trust No' },
  { name: 'hs_police_trust_yes', label: 'Police Trust Yes' },
  {
    name: 'hs_political_donations_likely',
    label: 'Political Donations Likely',
  },
  {
    name: 'hs_political_donations_unlikely',
    label: 'Political Donations Unlikely',
  },
  {
    name: 'hs_political_troll_entertaining',
    label: 'political troll entertaining',
  },
  { name: 'hs_political_troll_negative', label: 'political troll negative' },
  { name: 'hs_public_transit_oppose', label: 'Public Transit Oppose' },
  { name: 'hs_public_transit_support', label: 'Public Transit Support' },
  { name: 'hs_rank_choice_voting_oppose', label: 'Rank Choice Voting Oppose' },
  {
    name: 'hs_rank_choice_voting_support',
    label: 'Rank Choice Voting Support',
  },
  { name: 'hs_redistricting_indep_com', label: 'Redistricting Indep Com' },
  { name: 'hs_redistricting_state_leg', label: 'Redistricting State Leg' },
  { name: 'hs_regulations_good', label: 'Regulations Good' },
  { name: 'hs_regulations_too_harsh', label: 'Regulations Too Harsh' },
  { name: 'hs_responsiveness_email', label: 'Responsiveness Email' },
  { name: 'hs_responsiveness_live', label: 'Responsiveness Live' },
  { name: 'hs_responsiveness_sms', label: 'Responsiveness Sms' },
  { name: 'hs_rideshare_user', label: 'Rideshare User' },
  { name: 'hs_rideshare_user_no', label: 'Rideshare User No' },
  {
    name: 'hs_right_wing_conspiracy_believer',
    label: 'right wing conspiracy believer',
  },
  {
    name: 'hs_right_wing_conspiracy_nonbeliever',
    label: 'right wing conspiracy nonbeliever',
  },
  { name: 'hs_same_sex_marriage_oppose', label: 'Same Sex Marriage Oppose' },
  { name: 'hs_same_sex_marriage_support', label: 'Same Sex Marriage Support' },
  { name: 'hs_school_choice_oppose', label: 'School Choice Oppose' },
  { name: 'hs_school_choice_support', label: 'School Choice Support' },
  { name: 'hs_school_funding_less', label: 'School Funding Less' },
  { name: 'hs_school_funding_more', label: 'School Funding More' },
  { name: 'hs_sell_federal_lands_oppose', label: 'Sell Federal Lands Oppose' },
  {
    name: 'hs_sell_federal_lands_support',
    label: 'Sell Federal Lands Support',
  },
  { name: 'hs_snap_not_important', label: 'snap not important' },
  { name: 'hs_snap_protect', label: 'snap protect' },
  {
    name: 'hs_social_media_truth_vs_speech_free_speech',
    label: 'Social Media Truth Vs Speech Free Speech',
  },
  {
    name: 'hs_social_media_truth_vs_speech_truth',
    label: 'Social Media Truth Vs Speech Truth',
  },
  { name: 'hs_social_media_user', label: 'Social Media User' },
  {
    name: 'hs_social_media_user_frequent',
    label: 'social media user frequent',
  },
  {
    name: 'hs_social_media_user_no_or_infrequent',
    label: 'Social Media User No Or Infrequent',
  },
  {
    name: 'hs_social_security_tax_increase_oppose',
    label: 'Social Security Tax Increase Oppose',
  },
  {
    name: 'hs_social_security_tax_increase_support',
    label: 'Social Security Tax Increase Support',
  },
  { name: 'hs_solar_panel_buyer_no', label: 'Solar Panel Buyer No' },
  { name: 'hs_solar_panel_buyer_yes', label: 'Solar Panel Buyer Yes' },
  {
    name: 'hs_stadium_public_financing_approve',
    label: 'Stadium Public Financing Approve',
  },
  {
    name: 'hs_stadium_public_financing_disapprove',
    label: 'Stadium Public Financing Disapprove',
  },
  { name: 'hs_state_level_fema_oppose', label: 'State Level Fema Oppose' },
  { name: 'hs_state_level_fema_support', label: 'State Level Fema Support' },
  { name: 'hs_super_power_policy_oppose', label: 'super power policy oppose' },
  {
    name: 'hs_super_power_policy_support',
    label: 'super power policy support',
  },
  { name: 'hs_tax_cuts_oppose', label: 'Tax Cuts Oppose' },
  { name: 'hs_tax_cuts_support', label: 'Tax Cuts Support' },
  { name: 'hs_teachers_union_negative', label: 'Teachers Union Negative' },
  { name: 'hs_teachers_union_positive', label: 'Teachers Union Positive' },
  {
    name: 'hs_traditional_gender_roles_negative',
    label: 'traditional gender roles negative',
  },
  {
    name: 'hs_traditional_gender_roles_positive',
    label: 'traditional gender roles positive',
  },
  { name: 'hs_trans_athlete_no', label: 'Trans Athlete No' },
  { name: 'hs_trans_athlete_yes', label: 'Trans Athlete Yes' },
  { name: 'hs_tribalism_open_minded', label: 'Tribalism Open Minded' },
  { name: 'hs_trust_science_always', label: 'Trust Science Always' },
  { name: 'hs_trust_science_rarely', label: 'Trust Science Rarely' },
  { name: 'hs_tv_most_trusted_news_cnn', label: 'Tv Most Trusted News Cnn' },
  { name: 'hs_tv_most_trusted_news_fox', label: 'Tv Most Trusted News Fox' },
  {
    name: 'hs_tv_most_trusted_news_msnbc',
    label: 'Tv Most Trusted News Msnbc',
  },
  {
    name: 'hs_tv_news_source_most_trusted_cnn',
    label: 'tv news source most trusted cnn',
  },
  {
    name: 'hs_tv_news_source_most_trusted_fox',
    label: 'tv news source most trusted fox',
  },
  {
    name: 'hs_tv_news_source_most_trusted_msnbc',
    label: 'tv news source most trusted msnbc',
  },
  {
    name: 'hs_tv_news_source_most_trusted_newsmax',
    label: 'tv news source most trusted newsmax',
  },
  { name: 'hs_tv_viewer_free_streaming', label: 'Tv Viewer Free Streaming' },
  { name: 'hs_tv_viewer_not_viewer', label: 'Tv Viewer Not Viewer' },
  { name: 'hs_tv_viewer_watch_any_tv', label: 'Tv Viewer Watch Any Tv' },
  {
    name: 'hs_tv_viewer_watch_paid_streaming',
    label: 'Tv Viewer Watch Paid Streaming',
  },
  { name: 'hs_unions_beneficial', label: 'Unions Beneficial' },
  { name: 'hs_unions_not_beneficial', label: 'Unions Not Beneficial' },
  {
    name: 'hs_united_healthcare_at_fault',
    label: 'United Healthcare At Fault',
  },
  {
    name: 'hs_united_healthcare_no_fault',
    label: 'United Healthcare No Fault',
  },
  { name: 'hs_vaping_user_no', label: 'Vaping User No' },
  { name: 'hs_vaping_user_yes', label: 'Vaping User Yes' },
  { name: 'hs_violent_crime_not_worried', label: 'Violent Crime Not Worried' },
  {
    name: 'hs_violent_crime_very_worried',
    label: 'Violent Crime Very Worried',
  },
  { name: 'hs_violent_crime_worried', label: 'violent crime worried' },
  {
    name: 'hs_voting_fraud_concern_barriers',
    label: 'voting fraud concern barriers',
  },
  {
    name: 'hs_voting_fraud_concern_fraud',
    label: 'Voting Fraud Concern Fraud',
  },
  {
    name: 'hs_voting_fraud_concern_oppression',
    label: 'Voting Fraud Concern Oppression',
  },
  {
    name: 'hs_wealth_acquired_advantages',
    label: 'Wealth Acquired Advantages',
  },
  { name: 'hs_wealth_acquired_hardwork', label: 'Wealth Acquired Hardwork' },
  { name: 'Parties_Description', label: 'Party registration' },
  {
    name: 'Residence_HHParties_Description',
    label: 'Household party mix',
  },
  {
    name: 'VoterParties_Change_Changed_Party',
    label: 'Has changed party registration',
  },
  {
    name: 'hs_ideology_overall_party_dem',
    label: 'Modeled Democratic partisanship (0-100)',
  },
  {
    name: 'hs_ideology_overall_party_gop',
    label: 'Modeled Republican partisanship (0-100)',
  },
  {
    name: 'hs_ideology_overall_party_indep',
    label: 'Modeled independent lean (0-100)',
  },
  {
    name: 'hs_ideology_general_conservative',
    label: 'Modeled conservative ideology (0-100)',
  },
  {
    name: 'hs_ideology_general_liberal',
    label: 'Modeled liberal ideology (0-100)',
  },
  {
    name: 'hs_ideology_general_moderate',
    label: 'Modeled moderate ideology (0-100)',
  },
  {
    name: 'hs_ticket_splitter_yes',
    label: 'Likely ticket splitter (0-100)',
  },
  {
    name: 'hs_political_donations_likely',
    label: 'Likely political donor (0-100)',
  },
]
