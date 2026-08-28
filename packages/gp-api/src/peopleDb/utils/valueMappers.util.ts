// Wire value -> the value the voter file actually stores. A filter binds the
// mapped value as a parameter; `packEncoder.utils.ts` inverts these to turn a
// stored value back into a pack byte, so a pack byte can never disagree with
// what the same selection would have filtered on. `null` means the selection
// is "no value stored" rather than a value to match.
export const VALUE_MAPPERS = {
  ethnicity: (value: string): string | null => {
    switch (value) {
      case 'Asian':
        return 'East and South Asian'
      case 'European':
        return 'European'
      case 'Hispanic':
        return 'Hispanic and Portuguese'
      case 'African American':
        return 'Likely African-American'
      case 'Other':
        return 'Other'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  presenceOfChildren: (value: string): string | null => {
    switch (value) {
      case 'Yes':
        return 'Y'
      case 'No':
        return 'N'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  // 'Yes' is the wire value behind the "Homeowner" pill (ENG-10947) and
  // folds Probable Home Owner in, since the product taxonomy collapsed
  // Yes/Likely into one Homeowner bucket. 'Likely' is kept, unfolded, only
  // for saved filters persisted before the collapse (homeownerLikely).
  homeowner: (value: string): string | string[] | null => {
    switch (value) {
      case 'Yes':
        return ['Home Owner', 'Probable Home Owner']
      case 'Likely':
        return 'Probable Home Owner'
      case 'No':
        return 'Renter'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  educationLevel: (value: string): string | null => {
    switch (value) {
      case 'None':
        return 'Did Not Complete High School Likely'
      case 'High School Diploma':
        return 'Completed High School Likely'
      case 'Technical School':
        return 'Attended Vocational/Technical School Likely'
      case 'Some College':
        return 'Attended But Did Not Complete College Likely'
      case 'College Degree':
        return 'Completed College Likely'
      case 'Graduate Degree':
        return 'Completed Graduate School Likely'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  gender: (value: string): string | null => {
    switch (value) {
      case 'M':
        return 'M'
      case 'F':
        return 'F'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  veteranStatus: (value: string): string | null => {
    switch (value) {
      case 'Yes':
        return 'Yes'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
  maritalStatus: (value: string): string | null => {
    switch (value) {
      case 'Inferred Married':
        return 'Inferred Married'
      case 'Inferred Single':
        return 'Inferred Single'
      case 'Married':
        return 'Married'
      case 'Single':
        return 'Single'
      case 'Unknown':
        return null
      default:
        return value
    }
  },
} as const
