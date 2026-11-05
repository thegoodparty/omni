import type {
  ContactUploadField,
  ContactUploadStatus,
} from '@goodparty_org/contracts'
import { CONTACTS_DATA_TITLE } from '../../../shared/contactsLabels'

export const UPLOAD_HISTORY_PATH = '/dashboard/contacts/uploads'

// The contacts page with the import wizard open.
export const IMPORT_CONTACTS_HREF = '/dashboard/contacts?import=1'

export const uploadDetailPath = (uploadId: string): string =>
  `${UPLOAD_HISTORY_PATH}/${encodeURIComponent(uploadId)}`

// An upload's page with one processed row's person open (ProcessedRows).
export const UPLOAD_ROW_PARAM = 'row'
export const uploadRowPath = (uploadId: string, rowId: string): string =>
  `${uploadDetailPath(uploadId)}?${UPLOAD_ROW_PARAM}=${encodeURIComponent(rowId)}`

const people = (count: number): string =>
  `${count.toLocaleString()} ${count === 1 ? 'person' : 'people'}`

const rows = (count: number): string =>
  `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'}`

const FIELD_NAMES: Record<string, string> = {
  email: 'email',
  cellPhone: 'cell phone',
  landline: 'landline',
  address: 'address',
  addressLine: 'address',
  city: 'city',
  zip: 'ZIP',
  firstName: 'first name',
  lastName: 'last name',
}

const joinWords = (words: string[]): string =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`

const fieldList = (fields: string[]): string =>
  joinWords(fields.map((field) => FIELD_NAMES[field] ?? field))

const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1)

type ImportActivityKind = 'matched' | 'new' | 'resolved' | 'resolvedNew'

// Serve's copy, which also holds every string both products share, so the
// vocabulary check reads all of it. WIN_IMPORT_CONTACTS_COPY swaps the nouns.
export const SERVE_IMPORT_CONTACTS_COPY = {
  importContacts: 'Import contacts',
  back: 'Back',
  needsInputAlert: {
    oneTitle: (count: number, uploadName: string) =>
      `${people(count)} from “${uploadName}” ${count === 1 ? 'needs' : 'need'} your input`,
    oneBody: 'Choose who they are to finish this import.',
    review: 'Review',
    manyTitle: (count: number) =>
      `${count.toLocaleString()} imports need your input`,
    manyBody: 'Choose who each person is to finish them.',
    seeImports: 'See import history',
  },
  failedAlert: {
    oneTitle: (uploadName: string) => `“${uploadName}” didn't finish importing`,
    oneBody: 'Open it to see what went wrong and try again.',
    open: 'Open import',
    manyTitle: (count: number) =>
      `${count.toLocaleString()} imports didn't finish`,
    manyBody: 'Open them to see what went wrong and try again.',
    seeImports: 'See import history',
  },
  historySection: {
    title: 'Your imports',
    caption: 'People you added from your own files.',
  },
  wizard: {
    title: 'Import contacts',
    fileTitle: 'Which file has your people?',
    fileCaption:
      'Use a CSV file of 25 MB or less, with a first and last name for each person.',
    dropHere: 'Drop a CSV here',
    chooseFile: 'Choose a file',
    chooseAnotherFile: 'Choose another file',
    peopleFound: (count: number) => `${people(count)} found`,
    namesRequired: (counts: { total: number; withNames: number } | null) =>
      counts === null
        ? 'First and last name are required.'
        : `First and last name are required: ${
            counts.withNames === counts.total
              ? counts.total === 1
                ? '1 person has both'
                : `all ${people(counts.total)} have both`
              : `${counts.withNames.toLocaleString()} of ${people(counts.total)} have both`
          }.`,
    notCsv: 'This file is not a CSV. Save it as a CSV and try again.',
    tooBig:
      'This file is over 25 MB. Split it into smaller files and try again.',
    noRows: 'This file has no people in it. Add them and try again.',
    tooManyRows:
      'This file has more than 100,000 people. Split it into smaller files and try again.',
    unreadable: "We couldn't read this file. Save it as a CSV and try again.",
    columnsTitle: 'Is each column matched correctly?',
    columnsCaption: "Check the examples and fix any that don't fit.",
    columnInFile: 'Column in your file',
    importAs: 'Import as',
    doNotImport: 'Do not import',
    showMoreColumns: (count: number) =>
      `Show ${count.toLocaleString()} more ${count === 1 ? 'column' : 'columns'}`,
    columnErrors: {
      missing: {
        firstName: 'Choose first name here or in another row.',
        lastName: 'Choose last name here or in another row.',
      },
      empty: {
        firstName: 'This column is empty. Choose the column with first names.',
        lastName: 'This column is empty. Choose the column with last names.',
      },
      noOneHasBoth: 'No one has both a first and last name in these columns.',
    },
    nameTitle: 'What do you want to call this import?',
    nameCaption: 'Give it a name so you can find it later.',
    nameLabel: 'Import name',
    namePlaceholder: 'e.g. Town hall sign-in',
    consent:
      'These people agreed to hear from me, including by email. I am responsible for that.',
    continue: 'Continue',
    importPeople: (count: number) => `Import ${people(count)}`,
    sendingTitle: 'Uploading your file',
    sendingLine: (count: number) => `Sending ${people(count)}`,
    uploadedTitle: 'Your file is uploaded',
    uploadedLine: "We're matching your people. It usually takes a few minutes.",
    seeImport: 'See your import',
    importFailed: "We couldn't import this file. Check it and try again.",
  },
  fields: {
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    cellPhone: 'Cell phone',
    landline: 'Landline',
    addressLine: 'Address',
    city: 'City',
    zip: 'ZIP',
  } satisfies Record<ContactUploadField, string>,
  status: {
    awaiting_file: 'Uploading',
    processing: 'Processing',
    needs_input: 'Needs input',
    complete: 'Complete',
    failed: 'Failed',
  } satisfies Record<ContactUploadStatus, string>,
  history: {
    title: 'Import history',
    backToContacts: 'Back to Constituents',
    dateColumn: 'Date',
    nameColumn: 'Name',
    fileColumn: 'File',
    importedByColumn: 'Imported by',
    statusColumn: 'Status',
    fileAndUploader: (fileName: string, uploader: string | null) =>
      uploader ? `${fileName}, ${uploader}` : fileName,
    emptyTitle: 'No imports yet',
    emptyMessage: 'Import a file to add people to your constituents.',
    loadFailed: "We couldn't load your imports. Refresh the page to try again.",
  },
  detail: {
    backToHistory: 'Back to import history',
    meta: (
      fileName: string,
      date: string,
      uploader: string | null,
      rowCount: number | null,
    ) =>
      [
        fileName,
        uploader ? `Imported ${date} by ${uploader}` : `Imported ${date}`,
        ...(rowCount === null ? [] : [people(rowCount)]),
      ].join(' · '),
    imported: 'Imported',
    matched: 'Already in your constituent list',
    updated: (count: number) => `${count.toLocaleString()} updated`,
    added: 'New people',
    needsInput: 'Need you to choose who they are',
    invalid: 'Need a first and last name',
    skipped: 'Skipped by you',
    processing: "We're matching your people. This page updates when it's done.",
    failed: "This import didn't finish. Try again.",
    tryAgain: 'Try again',
    importNewFile: 'Import a new file',
    retryFailed: "We couldn't restart this import. Try again.",
    loadFailed: "We couldn't load this import. Refresh the page to try again.",
  },
  review: {
    discardTitle: 'Discard changes?',
    discardBody: 'Your choices for these rows will be lost.',
    keepEditing: 'Keep editing',
    discard: 'Discard',
    title: (count: number) =>
      `${rows(count)} ${count === 1 ? 'needs' : 'need'} your input`,
    caption: "We weren't sure who these people are. Pick one answer for each.",
    sameAs: (label: string) => `Same as ${label}`,
    newPerson: 'New person',
    skip: 'Skip this row',
    acceptLikely: (count: number | null) =>
      count === null
        ? 'Accept all likely matches'
        : `Accept all ${count.toLocaleString()} likely ${count === 1 ? 'match' : 'matches'}`,
    save: 'Save my answers',
    decideLater: 'Decide later',
    showMore: 'Show more rows',
    saveFailed: "We couldn't save your answers. Try again.",
  },
  processed: {
    title: 'Processed rows',
    searchLabel: 'Search processed rows',
    searchPlaceholder: 'Search by name or email',
    nameColumn: 'Name',
    emailColumn: 'Email',
    whatWeDidColumn: 'What we did',
    showMore: 'Show more rows',
    empty: 'No rows match your search. Try another name or email.',
    noRows: 'No rows were added from this file yet.',
    filterLabel: 'Show rows',
    filterAll: 'All',
    filterInFile: 'In your constituent file',
    filterNotInFile: 'Not in your constituent file',
    filteredEmpty: 'No rows match this filter. Pick All to see every row.',
    whatWeDid: (
      outcome: 'matched' | 'new' | 'resolved',
      isNewPerson: boolean,
      changedFields: string[],
    ) => {
      if (outcome === 'new') return 'New person. Added.'
      if (outcome === 'resolved') {
        return isNewPerson
          ? 'You added them as a new person.'
          : 'You matched this row.'
      }
      return changedFields.length > 0
        ? `Already in your constituents. Updated ${fieldList(changedFields)}.`
        : 'Already in your constituents.'
    },
  },
  skippedRows: {
    skippedTitle: 'Rows you skipped',
    skippedCaption:
      'You chose to skip these rows, so we left them out of this import.',
    invalidTitle: 'Rows missing a first or last name',
    invalidCaption:
      'Add a first and last name to each row, then import them again.',
    download: 'Download these rows',
    downloadFailed: "We couldn't download these rows. Try again.",
    loadFailed: "We couldn't load these rows. Close this and try again.",
    rowColumn: 'Row',
    rowNumber: (rowNumber: number) => `Row ${rowNumber}`,
    noName: 'No name',
    showMore: 'Show more rows',
    fileName: (fileName: string, outcome: 'skipped' | 'invalid') =>
      `${fileName.replace(/\.csv$/i, '')} ${outcome === 'skipped' ? 'skipped rows' : 'missing a name'}.csv`,
  },
  changeMatch: {
    title: 'Who is this person?',
    fromUpload: (uploadName: string) => `From ${uploadName}.`,
    someoneElse: 'Someone else',
    searchLabel: 'Search your constituents',
    searchPlaceholder: 'Search by name, phone or email',
    noResults: 'No constituents found',
    warnTitle: 'Change this match?',
    warnMessage: (name: string) =>
      `Notes and activity stay with ${name}. They don't move to the new match.`,
    continue: 'Continue',
    cancel: 'Cancel',
    submit: 'Change match',
    failed: "We couldn't change this match. Try again.",
  },
  person: {
    email: 'Email',
    cameFromUpload: (uploadName: string) => `Came from upload ${uploadName}`,
    cameFromFile: 'Came from the constituent file',
    changeMatch: 'Change match',
  },
  activity: {
    title: (
      kind: ImportActivityKind,
      isFirstImport: boolean,
      suppliedFields: string[],
      changedFields: string[],
    ): string => {
      if (isFirstImport) {
        return suppliedFields.length > 0
          ? `${capitalize(fieldList(suppliedFields))} added`
          : 'Imported'
      }
      if (kind === 'resolved') return 'Matched by you'
      return changedFields.length > 0
        ? `${capitalize(fieldList(changedFields))} updated`
        : 'Nothing changed'
    },
    body: (kind: ImportActivityKind, uploadName: string) =>
      kind === 'new'
        ? `Added as a new person from ${uploadName}.`
        : kind === 'resolvedNew'
          ? `You added them as a new person from ${uploadName}.`
          : kind === 'resolved'
            ? `You matched this row from ${uploadName}.`
            : `Imported from ${uploadName}.`,
  },
}

// Win reads the Serve copy with its nouns swapped: voters and the voter file
// where Serve says constituents, the campaign where Serve says the office.
export const WIN_IMPORT_CONTACTS_COPY: typeof SERVE_IMPORT_CONTACTS_COPY = {
  ...SERVE_IMPORT_CONTACTS_COPY,
  wizard: {
    ...SERVE_IMPORT_CONTACTS_COPY.wizard,
    namePlaceholder: 'e.g. Volunteer sign-up',
  },
  history: {
    ...SERVE_IMPORT_CONTACTS_COPY.history,
    backToContacts: `Back to ${CONTACTS_DATA_TITLE.win}`,
    emptyMessage: 'Import a file to add people to your campaign.',
  },
  detail: {
    ...SERVE_IMPORT_CONTACTS_COPY.detail,
    matched: 'Already in your contacts',
  },
  processed: {
    ...SERVE_IMPORT_CONTACTS_COPY.processed,
    filterInFile: 'In your voter file',
    filterNotInFile: 'Not in your voter file',
    whatWeDid: (
      outcome: 'matched' | 'new' | 'resolved',
      isNewPerson: boolean,
      changedFields: string[],
    ) => {
      if (outcome === 'new') return 'New person. Added.'
      if (outcome === 'resolved') {
        return isNewPerson
          ? 'You added them as a new person.'
          : 'You matched this row.'
      }
      // A match to someone an earlier import added is not a voter.
      const already = isNewPerson
        ? 'Already added from an earlier import.'
        : 'Already in your voter file.'
      return changedFields.length > 0
        ? `${already} Updated ${fieldList(changedFields)}.`
        : already
    },
  },
  changeMatch: {
    ...SERVE_IMPORT_CONTACTS_COPY.changeMatch,
    searchLabel: 'Search your voters',
    noResults: 'No voters found',
  },
  person: {
    ...SERVE_IMPORT_CONTACTS_COPY.person,
    cameFromFile: 'Came from the voter file',
  },
}

const IMPORT_CONTACTS_COPY = {
  win: WIN_IMPORT_CONTACTS_COPY,
  serve: SERVE_IMPORT_CONTACTS_COPY,
}

export const getImportContactsCopy = (isWin: boolean) =>
  IMPORT_CONTACTS_COPY[isWin ? 'win' : 'serve']

export const candidateLabel = (candidate: {
  firstName: string | null
  lastName: string | null
  addressLine: string | null
  city: string | null
  age?: number | null
}): string => {
  const name = [candidate.firstName, candidate.lastName]
    .filter(Boolean)
    .join(' ')
  return [
    name,
    candidate.addressLine ?? candidate.city,
    candidate.age != null ? `${candidate.age} years old` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

export const formatUploadDate = (iso: string, now = new Date()): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (date.toDateString() === now.toDateString()) return 'today'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
