// Age keys retired by ENG-10752 (the overlapping 18-25/25-35/35-50/50+ split).
// Saved VoterFileFilter rows still carry them with their original query
// bounds, so read-side surfaces (ListFilterSummary) keep labeling them; the
// pickers only offer the new mutually exclusive ranges above.
export const legacyAgeOptions = [
  { key: 'age18_25', label: '18-25' },
  { key: 'age25_35', label: '25-35' },
  { key: 'age35_50', label: '35-50' },
  { key: 'age50Plus', label: '50+' },
]

const filterSections = [
  {
    title: 'General Information',
    fields: [
      {
        key: 'gender',
        label: 'Gender',
        options: [
          { key: 'genderMale', label: 'Male' },
          { key: 'genderFemale', label: 'Female' },
          { key: 'genderUnknown', label: 'Unknown' },
        ],
      },
      {
        key: 'age',
        label: 'Age',
        options: [
          { key: 'age18_24', label: '18-24' },
          { key: 'age25_34', label: '25-34' },
          { key: 'age35_49', label: '35-49' },
          { key: 'age50_64', label: '50-64' },
          { key: 'age65Plus', label: '65+' },
          { key: 'ageUnknown', label: 'Unknown' },
        ],
      },
      {
        key: 'political_party',
        label: 'Political Party',
        options: [
          { key: 'partyDemocrat', label: 'Democrat' },
          { key: 'partyIndependent', label: 'Independent' },
          { key: 'partyRepublican', label: 'Republican' },
          { key: 'partyOther', label: 'Other' },
        ],
      },
      {
        // Win-only (campaign activity): the wizard hides this for Serve
        // (VoterFileStep.tsx strips it like political_party) and pulls it out
        // to render above Support status instead of inline here (ENG-10839).
        key: 'contacts_made',
        label: 'Contacts Made',
        options: [
          { key: 'contactsMade0', label: '0' },
          { key: 'contactsMade1', label: '1' },
          { key: 'contactsMade2', label: '2' },
          { key: 'contactsMade3', label: '3' },
          { key: 'contactsMade4', label: '4' },
          { key: 'contactsMade5Plus', label: '5+' },
        ],
      },
    ],
  },
  {
    title: 'Contact Information',
    fields: [
      {
        key: 'cell_phone',
        label: 'Cell Phone',
        options: [{ key: 'hasCellPhone', label: 'Has Cell Phone' }],
      },
      {
        key: 'landline',
        label: 'Landline',
        options: [{ key: 'hasLandline', label: 'Has Landline' }],
      },
      {
        key: 'language',
        label: 'Language',
        options: [
          { key: 'languageEnglish', label: 'English' },
          { key: 'languageSpanish', label: 'Spanish' },
          { key: 'languageOther', label: 'Other' },
        ],
      },
    ],
  },
  {
    title: 'Voter Demographics',
    fields: [
      {
        key: 'voter_likely',
        label: 'Voter Likelihood',
        options: [
          { key: 'audienceUnknown', label: 'Unknown' },
          { key: 'audienceUnlikelyVoters', label: 'Unlikely' },
          { key: 'audienceUnreliableVoters', label: 'Unreliable' },
          { key: 'audienceLikelyVoters', label: 'Likely' },
          { key: 'audienceSuperVoters', label: 'Super' },
        ],
      },
      {
        key: 'children',
        label: 'Children',
        options: [
          { key: 'hasChildrenYes', label: 'Yes' },
          { key: 'hasChildrenNo', label: 'No' },
          { key: 'hasChildrenUnknown', label: 'Unknown' },
        ],
      },
      {
        key: 'homeowner',
        label: 'Homeowner',
        options: [
          { key: 'homeownerYes', label: 'Yes' },
          { key: 'homeownerLikely', label: 'Likely' },
          { key: 'homeownerNo', label: 'No' },
          { key: 'homeownerUnknown', label: 'Unknown' },
        ],
      },
    ],
  },
  {
    title: 'Demographic Information',
    fields: [
      {
        key: 'marital_status',
        label: 'Marital Status',
        options: [
          { key: 'married', label: 'Married' },
          { key: 'likelyMarried', label: 'Likely Married' },
          { key: 'single', label: 'Single' },
          { key: 'likelySingle', label: 'Likely Single' },
          { key: 'maritalUnknown', label: 'Unknown' },
        ],
      },
      {
        key: 'veteran_status',
        label: 'Veteran Status',
        options: [
          { key: 'veteranYes', label: 'Yes' },
          { key: 'veteranUnknown', label: 'Unknown' },
        ],
      },
      {
        key: 'business_owner',
        label: 'Business Owner',
        options: [
          { key: 'businessOwnerYes', label: 'Yes' },
          { key: 'businessOwnerUnknown', label: 'Unknown' },
        ],
      },
      {
        key: 'education',
        label: 'Level of Education',
        options: [
          { key: 'educationNone', label: 'None' },
          { key: 'educationHighSchoolDiploma', label: 'High School Diploma' },
          { key: 'educationTechnicalSchool', label: 'Technical School' },
          { key: 'educationSomeCollege', label: 'Some College' },
          { key: 'educationCollegeDegree', label: 'College Degree' },
          { key: 'educationGraduateDegree', label: 'Graduate Degree' },
          { key: 'educationUnknown', label: 'Unknown' },
        ],
      },
      {
        key: 'income_ranges',
        label: 'Household Income Range',
        options: [
          { key: 'incomeUnder25k', label: 'Under $25k' },
          { key: 'income25kTo35k', label: '$25k - $35k' },
          { key: 'income35kTo50k', label: '$35k - $50k' },
          { key: 'income50kTo75k', label: '$50k - $75k' },
          { key: 'income75kTo100k', label: '$75k - $100k' },
          { key: 'income100kTo125k', label: '$100k - $125k' },
          { key: 'income125kTo150k', label: '$125k - $150k' },
          { key: 'income150kTo200k', label: '$150k - $200k' },
          { key: 'income200kPlus', label: '$200k+' },
          { key: 'incomeUnknown', label: 'Unknown' },
        ],
      },
      {
        key: 'ethnicity',
        label: 'Ethnicity',
        options: [
          { key: 'ethnicityAfricanAmerican', label: 'African American' },
          { key: 'ethnicityAsian', label: 'Asian' },
          { key: 'ethnicityEuropean', label: 'European' },
          { key: 'ethnicityHispanic', label: 'Hispanic' },
          { key: 'ethnicityOther', label: 'Other' },
          { key: 'ethnicityUnknown', label: 'Unknown' },
        ],
      },
    ],
  },
]

export default filterSections
