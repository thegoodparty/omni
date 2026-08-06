import type { AdvertisedDimension } from '@/llm/tools/queryConstituentData.tool'

// GENERATED — do not edit by hand.
//
// "Generated" means LLM-assisted curation reviewed entry by entry: there is
// NO script that produces this file, and rerunning any schema-dump tooling
// would destroy the curated labels below. Regenerate (re-curate) when the
// mart's column set changes or the vendor ships a new vintage, following the
// conventions in this header, and review the full diff.
//
// The curated set of breakdown dimensions advertised to the model: a
// high-value slice of demographics (household makeup, education, tenure,
// veteran status, turnout, age, gender, urbanicity) followed by the hs_*
// modeled issue-support scores. Identity/behavior proxies — religion salience
// and behavior, church attendance, religious giving, candidate preference by
// gender or ethnicity, and ethnicity/language — plus party and
// district/geography columns are intentionally omitted; only genuine policy
// attitudes are surfaced. The full serve_agent_voters table stays queryable
// via the validator allowlist; this only shapes what the agent is guided
// toward.
//
// Conventions when regenerating (the labels are the model's ONLY meaning
// surface for these columns — describe_constituent_data returns them
// verbatim):
// - hs_* labels state the stance the score measures. PRIMARY SOURCE: the
//   vendor's L2 National Models User Guide (per-model cards giving the source
//   question and the dependent variable — the DV names the exact positive
//   answer class, which decides both meaning and direction). Secondary:
//   the column-documentation seed in gp-data-platform
//   (dbt/project/seeds/l2_column_classification.csv) for columns absent from
//   the current guide (older-release columns), and the briefing-chat topic
//   catalog (DISTRICT_TOPICS_CATALOG in llm/tools/districtTopics.tool.ts).
//   Never a Title-Case of the column name. The seed's template-generated
//   "higher score =" direction lines are NOT trusted. For columns whose
//   question changed between vendor releases, label to the release our data
//   actually holds (check per-state loaded_at), not the newest guide.
//   Scores are within-state percentile ranks centered at 50; scale/threshold
//   framing lives in HS_SCORE_SEMANTICS (llm/tools/hsScoreSemantics.ts), so
//   keep labels to the stance.
// - Categorical dimensions state their EXACT value tokens in the label —
//   the tokens are vendor-inconsistent ('Yes'/null vs 'Y'/null vs 'A'/'I' vs
//   spelled-out phrases) and unguessable. Verify with SELECT DISTINCT against
//   the mart when adding one.
export const SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS: AdvertisedDimension[] = [
  { name: 'Voters_Age', label: 'Age in years' },
  { name: 'Voters_Gender', label: "Gender (values 'M', 'F', or blank)" },
  {
    name: 'ConsumerData_RUS_Code',
    label: "Urbanicity (values 'Urban', 'Suburban', 'Rural')",
  },
  {
    name: 'ConsumerData_Education_of_Person',
    label:
      "Education level (modeled; values 'Completed College Likely', 'Completed High School Likely', 'Completed Graduate School Likely', 'Attended But Did Not Complete College Likely', 'Did Not Complete High School Likely', 'Attended Vocational/Technical School Likely', or null)",
  },
  {
    name: 'ConsumerData_Marital_Status',
    label:
      "Marital status (values 'Married', 'Inferred Married', 'Single', 'Inferred Single', or null)",
  },
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
    label: "Has children under 18 at home (values 'Y', 'N', or null = unknown)",
  },
  {
    name: 'ConsumerData_Single_Parent_in_Household',
    label: "Single-parent household (value 'Y' or null)",
  },
  {
    name: 'ConsumerData_Length_Of_Residence_Code',
    label: 'Years at current address',
  },
  { name: 'ConsumerData_Generations_In_HH', label: 'Generations in household' },
  { name: 'ConsumerDataLL_Veteran', label: "Veteran (value 'Yes' or null)" },
  {
    name: 'ConsumerData_Veteran_In_HH',
    label: "Veteran in household (value 'Y' or null)",
  },
  {
    name: 'ConsumerData_Senior_Adult_In_HH',
    label: "Senior adult in household (value 'Y' or null)",
  },
  {
    name: 'ConsumerData_Young_Adult_In_HH',
    label: "Young adult in household (value 'Y' or null)",
  },
  {
    name: 'Voters_Active',
    label: "Registration status (values 'A' = active, 'I' = inactive)",
  },
  {
    name: 'Voters_VotingPerformanceEvenYearGeneral',
    label: 'General-election turnout (%)',
  },
  {
    name: 'Voters_VotingPerformanceEvenYearPrimary',
    label: 'Primary-election turnout (%)',
  },
  { name: 'hs_abortion_pro_choice', label: 'Pro-choice on abortion' },
  { name: 'hs_abortion_pro_life', label: 'Pro-life on abortion' },
  { name: 'hs_activism', label: 'Engaged in activism' },
  {
    name: 'hs_affordability_changed_what_you_buy_no',
    label:
      'Says affordability has not changed what they buy (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_affordability_changed_what_you_buy_yes',
    label:
      'Says affordability has changed what they buy (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_affordable_housing_gov_has_role',
    label: 'Agrees government has a role in affordable housing',
  },
  {
    name: 'hs_affordable_housing_gov_no_role',
    label: 'Opposes government role in affordable housing',
  },
  {
    name: 'hs_age_limit_oppose',
    label: 'Opposes a maximum age of 75 for federally elected officials',
  },
  {
    name: 'hs_age_limit_support',
    label: 'Supports a maximum age of 75 for federally elected officials',
  },
  {
    name: 'hs_aliens_governenment_disclosed_all',
    label:
      'Believes the government has disclosed most of what it knows about aliens/UFOs (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_aliens_governenment_hiding_much',
    label:
      'Believes the government is hiding much about aliens/UFOs (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_amazon_exploitative',
    label: 'Believes Amazon is exploitative toward its workers',
  },
  {
    name: 'hs_amazon_good_jobs',
    label: 'Believes Amazon provides good jobs that pay well',
  },
  {
    name: 'hs_any_home_buyer',
    label:
      'Likely recent home buyer, first-time or repeat (modeled from actual 2024 buyers) (not centered at 50 — statewide baseline is about 60; read leans against that baseline)',
  },
  {
    name: 'hs_area_identity_rural',
    label:
      'Identifies where they live as rural (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_area_identity_suburban',
    label:
      'Identifies where they live as suburban (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_area_identity_urban',
    label:
      'Identifies where they live as urban (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_artificial_intelligence_excited',
    label: 'More excited than concerned about AI in daily life',
  },
  {
    name: 'hs_autonomous_vehicles_allow',
    label:
      'Believes self-driving vehicles should be allowed on the road (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_autonomous_vehicles_do_not_allow',
    label:
      'Believes self-driving vehicles should not be allowed on the road (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_campaign_finance_reform_high_priority',
    label:
      'Sees campaign finance reform as a high priority (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_campaign_finance_reform_less_important',
    label:
      'Sees campaign finance reform as less important (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_candidate_mail_do_not_read',
    label:
      'Does not read mail from candidates (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_candidate_mail_read_carefully',
    label:
      'Reads candidate mail carefully (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_candidate_mail_readership_do_not_read',
    label:
      'Does not read candidate campaign mail (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_candidate_mail_readership_read_carefully',
    label:
      'Reads candidate campaign mail carefully (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_capitalism_believe_flawed',
    label: 'Believes capitalism is fundamentally flawed',
  },
  {
    name: 'hs_capitalism_believe_sound',
    label: 'Believes capitalism is fundamentally sound',
  },
  { name: 'hs_casino_oppose', label: 'Opposes casinos' },
  { name: 'hs_casino_support', label: 'Supports casinos' },
  {
    name: 'hs_charity_giving_enviro_cause',
    label: 'Most likely to support environmental charities',
  },
  {
    name: 'hs_charity_giving_international_aid',
    label: 'Most likely to support international aid charities',
  },
  {
    name: 'hs_charity_giving_performing_arts',
    label: 'Most likely to support performing arts charities',
  },
  {
    name: 'hs_charity_giving_vet_cause',
    label: "Most likely to support veterans' charities",
  },
  { name: 'hs_charter_schools_oppose', label: 'Opposes charter schools' },
  { name: 'hs_charter_schools_support', label: 'Supports charter schools' },
  {
    name: 'hs_china_foreign_policy_advesarial',
    label: 'Sees China as a threat requiring a hardline approach',
  },
  {
    name: 'hs_china_foreign_policy_work_with',
    label: 'Sees China as a trade partner the US should work with',
  },
  {
    name: 'hs_civil_liberties_oppose',
    label:
      "Believes anti-terror policies don't go far enough to protect us (limited coverage: data exists in only 12 states; null elsewhere)",
  },
  {
    name: 'hs_civil_liberties_support',
    label:
      'Believes anti-terror policies go too far restricting civil liberties (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_climate_change_believer',
    label: 'Believes in human-caused climate change',
  },
  {
    name: 'hs_climate_change_nonbeliever',
    label: 'Rejects human-caused climate change',
  },
  {
    name: 'hs_college_admissions_consider_race',
    label: 'Believes colleges should be allowed to consider race in admissions',
  },
  {
    name: 'hs_college_admissions_do_not_consider_race',
    label: 'Believes colleges should not consider race in admissions',
  },
  {
    name: 'hs_community_college_free_oppose',
    label:
      'Opposes free community college (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_community_college_free_support',
    label:
      'Supports free community college (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_community_not_integrated',
    label:
      'Does not feel integrated into their local community (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_community_very_integrated',
    label:
      'Feels very integrated into their local community (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_concerned_job_loss_due_to_ai_no',
    label:
      'Not concerned about losing their job to AI (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_concerned_job_loss_due_to_ai_yes',
    label:
      'Concerned about losing their job to AI (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_conspiracy_believer',
    label:
      'Open to conspiracy theories (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_conspiracy_nonbeliever',
    label:
      'Firmly rejects conspiracy theories (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_consumer_value_brand_savings',
    label:
      'Prioritizes brand reputation for quality when shopping for big-ticket items (vs discounts or environmental impact)',
  },
  {
    name: 'hs_consumer_value_environment',
    label: 'Values environmental impact when shopping',
  },
  {
    name: 'hs_consumer_value_low_cost',
    label: 'Values low cost when shopping',
  },
  {
    name: 'hs_critical_race_theory_books_ban',
    label:
      'Supports banning books on race and gender topics from school libraries',
  },
  {
    name: 'hs_critical_race_theory_books_do_not_ban',
    label:
      'Opposes banning books on race and gender topics from school libraries',
  },
  {
    name: 'hs_crypto_buyer_no',
    label: 'Unlikely to buy cryptocurrency in the next year',
  },
  {
    name: 'hs_crypto_buyer_yes',
    label: 'Likely to buy cryptocurrency in the next year',
  },
  {
    name: 'hs_crypto_increase_restrictions',
    label: 'Wants more government regulation of cryptocurrency',
  },
  {
    name: 'hs_crypto_reduce_leave_as_is',
    label: 'Wants crypto regulation reduced or kept as is',
  },
  {
    name: 'hs_crypto_reduce_restrictions',
    label: 'Wants less government regulation of cryptocurrency',
  },
  {
    name: 'hs_dating_optimistic',
    label:
      'Optimistic about dating (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_dating_pessimistic',
    label:
      'Pessimistic about dating (limited coverage: no data in 12 states; null there)',
  },
  { name: 'hs_death_penalty_oppose', label: 'Opposes the death penalty' },
  { name: 'hs_death_penalty_support', label: 'Supports the death penalty' },
  {
    name: 'hs_defense_spending_increase',
    label: 'Wants the defense budget increased',
  },
  {
    name: 'hs_defense_spending_reduce',
    label: 'Wants the defense budget reduced',
  },
  { name: 'hs_dei_oppose', label: 'Opposes DEI initiatives' },
  { name: 'hs_dei_support', label: 'Supports DEI initiatives' },
  {
    name: 'hs_despondency_ahead',
    label:
      'Feels ahead of where they expected to be in life (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_despondency_far_behind',
    label:
      'Feels far behind where they expected to be in life (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_despondency_on_pace',
    label:
      'Feels on pace with where they expected to be in life (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_doge_oppose',
    label: 'Opposes DOGE (Department of Government Efficiency)',
  },
  {
    name: 'hs_doge_support',
    label: 'Supports DOGE (Department of Government Efficiency)',
  },
  {
    name: 'hs_domestic_deployment_of_troops_oppose',
    label:
      'Opposes deploying troops domestically (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_domestic_deployment_of_troops_support',
    label:
      'Supports deploying troops domestically (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_dropoff_fill_entire_ballot',
    label: 'Fills out the entire ballot, including down-ballot races',
  },
  {
    name: 'hs_dropoff_fill_only_top',
    label:
      'Skips at least some down-ballot races rather than voting the entire ballot',
  },
  {
    name: 'hs_econ_anxiety_not_worried',
    label: 'Not worried about job security, retirement, or economic prospects',
  },
  {
    name: 'hs_econ_anxiety_very_worried',
    label: 'Very worried about job security, retirement, or economic prospects',
  },
  {
    name: 'hs_economic_despondency_ahead',
    label:
      'Feels ahead of where they expected to be at this stage of life (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_economic_despondency_far_behind',
    label:
      'Feels far behind where they expected to be at this stage of life (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_electric_vehicle_likely_buyer',
    label:
      'Owns an electric vehicle or is likely to buy one in the next three years',
  },
  {
    name: 'hs_electric_vehicle_not_likely',
    label: 'Unlikely to buy an electric vehicle',
  },
  {
    name: 'hs_epstein_files_important',
    label:
      'Sees the Epstein files as important (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_epstein_files_unimportant_or_hoax',
    label:
      'Sees the Epstein files as unimportant or a hoax (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_family_medical_leave_oppose',
    label:
      'Opposes paid family/medical leave (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_family_medical_leave_support',
    label:
      'Supports paid family/medical leave (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_felon_voting_oppose',
    label: 'Believes felons should forfeit the right to vote',
  },
  {
    name: 'hs_felon_voting_support',
    label: 'Supports restoring voting rights to felons who served their time',
  },
  {
    name: 'hs_gamer_no',
    label:
      'Does not play video games (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_gamer_yes',
    label:
      'Identifies as a gamer (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_gas_tax_oppose',
    label: 'Opposes raising the gas tax to fund road repairs',
  },
  {
    name: 'hs_gas_tax_support',
    label: 'Supports raising the gas tax to fund road repairs',
  },
  {
    // Direction confirmed from the vendor model card: the positive class is
    // respondents answering 'required' vs all softer answers (encouraged,
    // family choice, discouraged, unsure). Model: general_anti_vax_str_pro_vax.
    name: 'hs_general_anti_vax_pro_vax',
    label:
      'Believes childhood vaccinations (e.g. MMR) should be required, not merely encouraged or left to family choice (asked separately from Covid)',
  },
  { name: 'hs_gentrification_oppose', label: 'Opposes gentrification' },
  { name: 'hs_gentrification_support', label: 'Supports gentrification' },
  {
    name: 'hs_gig_work_keep_contractor',
    label: 'Believes gig workers should stay independent contractors',
  },
  {
    name: 'hs_gig_work_make_employees',
    label: 'Believes gig companies should treat workers as employees',
  },
  { name: 'hs_gig_worker_ever', label: 'Has ever done gig economy work' },
  { name: 'hs_gig_worker_now', label: 'Currently does gig economy work' },
  { name: 'hs_gig_worker_unlikely', label: 'Unlikely to do gig economy work' },
  { name: 'hs_green_new_deal_oppose', label: 'Opposes the Green New Deal' },
  { name: 'hs_green_new_deal_support', label: 'Supports the Green New Deal' },
  { name: 'hs_gun_control_oppose', label: 'Opposes gun control' },
  { name: 'hs_gun_control_support', label: 'Supports gun control' },
  {
    name: 'hs_ice_actions_oppose',
    label:
      'Opposes ICE enforcement actions (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_ice_actions_support',
    label:
      'Supports ICE enforcement actions (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_illegal_imm_process_unfair',
    label:
      'More concerned the US is unfair or inhumane to immigrants (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_illegal_imm_undesirable',
    label:
      'More concerned too many undesirable people are immigrating (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_immigration_process_unfair',
    label:
      'Sees the immigration process as unfair (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_immigration_undesirable',
    label:
      'Sees more immigration as undesirable (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_income_inequality_no_issue',
    label: 'Sees income inequality as not a real issue',
  },
  {
    name: 'hs_income_inequality_serious',
    label: 'Sees income inequality as a serious problem',
  },
  {
    name: 'hs_inflation_fault_biden',
    label: 'Blames inflation on Biden administration policies',
  },
  {
    name: 'hs_inflation_fault_corporate_america',
    label: 'Blames inflation on Corporate America',
  },
  {
    name: 'hs_inflation_fault_external_events',
    label:
      'Blames recent inflation on external events rather than government or corporate actors',
  },
  {
    name: 'hs_infrastructure_funding_enough_spent',
    label: 'Believes enough is spent on infrastructure',
  },
  {
    name: 'hs_infrastructure_funding_fund_more',
    label: 'Favors more infrastructure funding',
  },
  {
    name: 'hs_insurance_of_last_resort_government_should_not_provide',
    label:
      'Believes government should not provide insurance of last resort (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_insurance_of_last_resort_government_should_provide',
    label:
      'Believes government should provide insurance of last resort (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_israel_committing_genocide_no',
    label:
      'Does not believe Israel is committing genocide (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_israel_committing_genocide_yes',
    label:
      'Believes Israel is committing genocide (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_israel_military_actions_oppose',
    label: "Opposes Israel's military actions",
  },
  {
    name: 'hs_israel_military_actions_support',
    label: "Supports Israel's military actions",
  },
  {
    name: 'hs_jan_6th_pardons_oppose',
    label: 'Opposes pardons for January 6th defendants',
  },
  {
    name: 'hs_jan_6th_pardons_support',
    label:
      'Does not consider the January 6th pardons all problematic (includes mixed and unsure views)',
  },
  {
    name: 'hs_job_seeker_does_not_work',
    label: 'Does not work / not in the job market',
  },
  {
    name: 'hs_job_seeker_likely',
    label: 'Likely to look for a new job in the next six months',
  },
  {
    name: 'hs_job_seeker_unlikely',
    label: 'Unlikely to look for a new job in the next six months',
  },
  {
    name: 'hs_jobs_guarantee_oppose',
    label:
      'Opposes a federal jobs guarantee (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_jobs_guarantee_support',
    label:
      'Supports a federal jobs guarantee (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_likely_ev',
    label: 'Likely to vote early (EV)',
  },
  { name: 'hs_likely_mid_term_voter', label: 'Likely to vote in midterms' },
  {
    name: 'hs_likely_polling_turnout',
    label:
      'Likely to turn out to vote in presidential-year elections (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_likely_presidential_voter',
    label: 'Likely to vote in presidential elections',
  },
  { name: 'hs_likely_vbm', label: 'Likely to vote by mail (absentee ballot)' },
  {
    name: 'hs_listen_podcaster_carlson',
    label:
      "Listens to Tucker Carlson's podcast (limited coverage: no data in 12 states; null there)",
  },
  {
    name: 'hs_listen_podcaster_daily',
    label:
      'Most likely to listen to The Daily among political podcasts (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_listen_podcaster_left_leaning',
    label:
      'Listens to left-leaning podcasts (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_listen_podcaster_meidas',
    label:
      'Listens to the MeidasTouch podcast (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_listen_podcaster_right_leaning',
    label:
      'Listens to right-leaning podcasts (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_listen_podcaster_rogan',
    label:
      "Listens to Joe Rogan's podcast (limited coverage: no data in 12 states; null there)",
  },
  {
    name: 'hs_marijuana_legal_oppose',
    label: 'Opposes marijuana legalization',
  },
  {
    name: 'hs_marijuana_legal_support',
    label: 'Does not oppose marijuana legalization',
  },
  {
    name: 'hs_mass_deporations_oppose',
    label:
      'Opposes mass deportations (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_mass_deporations_support',
    label:
      'Supports mass deportations (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  { name: 'hs_medicaid_expansion_oppose', label: 'Opposes Medicaid expansion' },
  {
    name: 'hs_medicaid_expansion_support',
    label: 'Supports Medicaid expansion',
  },
  { name: 'hs_medicare_for_all_oppose', label: 'Opposes Medicare for All' },
  { name: 'hs_medicare_for_all_support', label: 'Supports Medicare for All' },
  { name: 'hs_mexican_wall_oppose', label: 'Opposes a border wall' },
  { name: 'hs_mexican_wall_support', label: 'Supports a border wall' },
  {
    name: 'hs_military_family_relationship_no',
    label: 'Neither they nor immediate family served in the US military',
  },
  {
    name: 'hs_military_family_relationship_yes',
    label: 'They or an immediate family member served in the US military',
  },
  {
    name: 'hs_military_family_self',
    label:
      'Personally served in the US military (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_min_wage_15_increase_oppose',
    label:
      'Opposes raising the minimum wage to $15 (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_min_wage_15_increase_support',
    label:
      'Supports raising the minimum wage to $15 (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_most_important_policy_item_economics',
    label: 'Sees economics as the most important policy issue',
  },
  {
    name: 'hs_most_important_policy_item_environment',
    label: 'Sees the environment as the most important policy issue',
  },
  {
    name: 'hs_most_important_policy_item_help_people',
    label: 'Sees helping people as the most important policy goal',
  },
  {
    name: 'hs_most_important_policy_keep_safe',
    label: 'Sees keeping people safe as the most important policy goal',
  },
  {
    name: 'hs_new_home_buyer',
    label:
      'Likely first-time home buyer (modeled from actual 2024 buyers) (not centered at 50 — statewide baseline is about 60; read leans against that baseline)',
  },
  {
    name: 'hs_news_independent',
    label:
      'Prefers independent news sources (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_news_mainstream',
    label:
      'Prefers mainstream news sources (limited coverage: no data in 12 states; null there)',
  },
  { name: 'hs_obamacare_aca_expand', label: 'Supports expanding the ACA' },
  { name: 'hs_obamacare_aca_oppose', label: 'Opposes the ACA' },
  { name: 'hs_obamacare_aca_protect', label: 'Supports protecting ACA' },
  {
    name: 'hs_online_gambling_less_legal',
    label: 'Wants online gambling more restricted',
  },
  {
    name: 'hs_online_gambling_more_legal',
    label: 'Believes online gambling should be legal and regulated',
  },
  {
    name: 'hs_opioid_crisis_enforce',
    label:
      'Treats opioid crisis as a law-enforcement issue (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_opioid_crisis_treat',
    label:
      'Treats opioid crisis as a health issue (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  { name: 'hs_pipeline_fracking_oppose', label: 'Opposes pipelines/fracking' },
  {
    name: 'hs_pipeline_fracking_support',
    label: 'Supports pipelines/fracking',
  },
  { name: 'hs_podcast_listener_no', label: 'Does not listen to podcasts' },
  { name: 'hs_podcast_listener_yes', label: 'Listens to podcasts' },
  { name: 'hs_police_trust_no', label: 'Does not trust the police' },
  { name: 'hs_police_trust_yes', label: 'Trusts the police' },
  {
    name: 'hs_political_donations_likely',
    label: 'Likely to donate to political causes',
  },
  {
    name: 'hs_political_donations_unlikely',
    label: 'Unlikely to donate to political causes',
  },
  {
    name: 'hs_political_troll_entertaining',
    label:
      'Finds political trolling entertaining (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_political_troll_negative',
    label:
      'Views political trolling negatively (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_public_transit_oppose',
    label: 'Opposes expanding public transit funding',
  },
  {
    name: 'hs_public_transit_support',
    label: 'Supports expanding public transit funding, even with higher taxes',
  },
  {
    name: 'hs_rank_choice_voting_oppose',
    label: 'Opposes ranked choice voting',
  },
  {
    name: 'hs_rank_choice_voting_support',
    label: 'Supports ranked choice voting',
  },
  {
    name: 'hs_redistricting_indep_com',
    label: 'Favors independent commissions drawing district lines',
  },
  {
    name: 'hs_redistricting_state_leg',
    label: 'Favors state legislatures drawing district lines',
  },
  { name: 'hs_regulations_good', label: 'Sees regulations as good' },
  { name: 'hs_regulations_too_harsh', label: 'Sees regulations as too harsh' },
  { name: 'hs_responsiveness_email', label: 'Responsive to email outreach' },
  {
    name: 'hs_responsiveness_live',
    label: 'Responsive to live phone outreach',
  },
  { name: 'hs_responsiveness_sms', label: 'Responsive to SMS / text outreach' },
  {
    name: 'hs_rideshare_user',
    label: 'Often uses rideshare services like Uber or Lyft',
  },
  { name: 'hs_rideshare_user_no', label: 'Does not use rideshare services' },
  {
    name: 'hs_right_wing_conspiracy_believer',
    label:
      'Believes right-wing conspiracy theories (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_right_wing_conspiracy_nonbeliever',
    label:
      'Rejects right-wing conspiracy theories (limited coverage: no data in 12 states; null there)',
  },
  { name: 'hs_same_sex_marriage_oppose', label: 'Opposes same-sex marriage' },
  { name: 'hs_same_sex_marriage_support', label: 'Supports same-sex marriage' },
  { name: 'hs_school_choice_oppose', label: 'Opposes school choice' },
  { name: 'hs_school_choice_support', label: 'Supports school choice' },
  {
    name: 'hs_school_funding_less',
    label: 'Opposes increasing school funding',
  },
  { name: 'hs_school_funding_more', label: 'Favors more school funding' },
  {
    name: 'hs_sell_federal_lands_oppose',
    label:
      'Opposes selling federal lands (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_sell_federal_lands_support',
    label:
      'Supports selling federal lands (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_snap_not_important',
    label:
      'Does not see protecting SNAP benefits as important (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_snap_protect',
    label:
      'Wants SNAP food assistance benefits protected (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_social_media_truth_vs_speech_free_speech',
    label:
      'Prioritizes free speech over truth enforcement on social media (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_social_media_truth_vs_speech_truth',
    label:
      'Prioritizes truth over unrestricted speech on social media (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_social_media_user',
    label:
      'Active social media user (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_social_media_user_frequent',
    label:
      'Frequent social media user (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_social_media_user_no_or_infrequent',
    label: 'Not an active social media user',
  },
  {
    name: 'hs_social_security_tax_increase_oppose',
    label:
      'Opposes raising Social Security taxes (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_social_security_tax_increase_support',
    label:
      'Supports raising Social Security taxes (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_solar_panel_buyer_no',
    label: 'Owns a home but is not interested in buying solar panels',
  },
  {
    name: 'hs_solar_panel_buyer_yes',
    label:
      'Considering buying solar panels within two years, or already has them',
  },
  {
    name: 'hs_stadium_public_financing_approve',
    label: 'Approves using local taxes to fund pro sports stadiums',
  },
  {
    name: 'hs_stadium_public_financing_disapprove',
    label: 'Disapproves of using local taxes to fund pro sports stadiums',
  },
  {
    name: 'hs_state_level_fema_oppose',
    label:
      'Opposes shifting FEMA disaster response to the states (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_state_level_fema_support',
    label:
      'Supports shifting FEMA disaster response to the states (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_super_power_policy_oppose',
    label:
      'Believes US policy should not prioritize maintaining economic and military superpower dominance (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_super_power_policy_support',
    label:
      'Believes US policy should prioritize maintaining economic and military superpower dominance (limited coverage: no data in 12 states; null there)',
  },
  { name: 'hs_tax_cuts_oppose', label: 'Opposes tax cuts' },
  { name: 'hs_tax_cuts_support', label: 'Supports tax cuts' },
  {
    name: 'hs_teachers_union_negative',
    label: 'Negative view of teachers unions',
  },
  {
    name: 'hs_teachers_union_positive',
    label: 'Positive view of teachers unions',
  },
  {
    name: 'hs_traditional_gender_roles_negative',
    label:
      'Views traditional gender roles negatively (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_traditional_gender_roles_positive',
    label:
      'Views traditional gender roles positively (limited coverage: no data in 12 states; null there)',
  },
  { name: 'hs_trans_athlete_no', label: 'Opposes trans athlete participation' },
  {
    name: 'hs_trans_athlete_yes',
    label: 'Supports trans athlete participation',
  },
  {
    name: 'hs_tribalism_open_minded',
    label:
      'Open-minded, low partisan tribalism (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_trust_science_always',
    label:
      'Always trusts science (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_trust_science_rarely',
    label:
      'Rarely trusts scientific consensus (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_tv_most_trusted_news_cnn',
    label:
      'Trusts CNN most for TV news — older survey vintage (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_tv_most_trusted_news_fox',
    label:
      'Trusts Fox most for TV news — older survey vintage (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_tv_most_trusted_news_msnbc',
    label:
      'Trusts MSNBC most for TV news — older survey vintage (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_tv_news_source_most_trusted_cnn',
    label:
      'Trusts CNN most for TV news — newer survey vintage (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_tv_news_source_most_trusted_fox',
    label:
      'Trusts Fox most for TV news — newer survey vintage (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_tv_news_source_most_trusted_msnbc',
    label:
      'Trusts MSNBC most for TV news — newer survey vintage (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_tv_news_source_most_trusted_newsmax',
    label:
      'Trusts Newsmax most for TV news — newer survey vintage (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_tv_viewer_free_streaming',
    label: 'Mainly watches free streaming platforms like YouTube',
  },
  { name: 'hs_tv_viewer_not_viewer', label: 'Does not typically watch TV' },
  {
    name: 'hs_tv_viewer_watch_any_tv',
    label: 'Watches traditional TV (cable, satellite, or over the air)',
  },
  {
    name: 'hs_tv_viewer_watch_paid_streaming',
    label: 'Watches paid streaming services',
  },
  { name: 'hs_unions_beneficial', label: 'Views unions as beneficial' },
  { name: 'hs_unions_not_beneficial', label: 'Views unions as not beneficial' },
  {
    name: 'hs_united_healthcare_at_fault',
    label:
      'Assigns UnitedHealthcare a great deal of blame, over its claim denials, for the December 2024 killing of its CEO (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_united_healthcare_no_fault',
    label:
      'Believes UnitedHealthcare is not responsible for the December 2024 killing of its CEO (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  { name: 'hs_vaping_user_no', label: 'Does not use vaping products' },
  { name: 'hs_vaping_user_yes', label: 'Uses vaping products' },
  {
    name: 'hs_violent_crime_not_worried',
    label: 'Not worried about violent crime',
  },
  {
    name: 'hs_violent_crime_very_worried',
    label:
      'Very worried about violent crime (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_violent_crime_worried',
    label:
      'Worried about violent crime (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_voting_fraud_concern_barriers',
    label:
      'More concerned about barriers to voting (limited coverage: no data in 12 states; null there)',
  },
  {
    name: 'hs_voting_fraud_concern_fraud',
    label: 'More concerned about voter fraud than about barriers to voting',
  },
  {
    name: 'hs_voting_fraud_concern_oppression',
    label:
      'Concerned about voter suppression (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_wealth_acquired_advantages',
    label:
      'Believes wealth is acquired through advantages people are handed (limited coverage: data exists in only 12 states; null elsewhere)',
  },
  {
    name: 'hs_wealth_acquired_hardwork',
    label:
      'Believes wealth is acquired through hard work (limited coverage: data exists in only 12 states; null elsewhere)',
  },
]
