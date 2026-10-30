import type {
  ContactUploadField,
  ContactUploadStatus,
} from '@goodparty_org/contracts'
import { CONTACTS_DATA_TITLE } from '../../../shared/contactsLabels'

export const UPLOAD_HISTORY_PATH = '/dashboard/contacts/uploads'

export const uploadDetailPath = (uploadId: string): string =>
  `${UPLOAD_HISTORY_PATH}/${encodeURIComponent(uploadId)}`

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
  uploadHistory: 'Upload history',
  wizard: {
    title: 'Import contacts',
    fileTitle: 'Which file has your people?',
    fileCaption:
      'Use a CSV file of 25 MB or less, with a first and last name for each person.',
    dropHere: 'Drop a CSV here',
    chooseFile: 'Choose a file',
    chooseAnotherFile: 'Choose another file',
    fileFound: (count: number, headers: string[]) =>
      `${people(count)} found. Columns in your file: ${headers.join(', ')}.`,
    notCsv: 'This file is not a CSV. Save it as a CSV and try again.',
    tooBig:
      'This file is over 25 MB. Split it into smaller files and try again.',
    noRows: 'This file has no people in it. Add them and try again.',
    tooManyRows:
      'This file has more than 100,000 people. Split it into smaller files and try again.',
    unreadable: "We couldn't read this file. Save it as a CSV and try again.",
    columnsTitle: 'Which column has each detail?',
    columnsCaption:
      'First and last name are required. Leave out anything else.',
    whatWeKeep: 'What we keep',
    columnInFile: 'Column in your file',
    example: 'Example',
    doNotImport: 'Do not import',
    nameTitle: 'What should we call this upload?',
    nameCaption: (count: number) =>
      `${people(count)} are in this file. Give it a name so you can find it later.`,
    nameLabel: 'Upload name',
    namePlaceholder: 'Name this upload',
    consent: 'These people agreed to hear from me. I am responsible for that.',
    continue: 'Continue',
    importPeople: (count: number) => `Import ${people(count)}`,
    sendingTitle: 'Uploading your file',
    sendingLine: (count: number) => `Sending ${people(count)}`,
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
    title: 'Upload history',
    caption: 'Files you have imported into your constituents',
    backToContacts: 'Back to Constituents',
    uploadColumn: 'Upload',
    uploadedColumn: 'Uploaded',
    statusColumn: 'Status',
    fileAndUploader: (fileName: string, uploader: string | null) =>
      uploader ? `${fileName}, ${uploader}` : fileName,
    emptyTitle: 'No uploads yet',
    emptyMessage: 'Import a file to add people to your constituents.',
    loadFailed: "We couldn't load your uploads. Refresh the page to try again.",
  },
  detail: {
    backToHistory: 'Back to Upload history',
    meta: (
      fileName: string,
      date: string,
      uploader: string | null,
      rowCount: number | null,
    ) =>
      [
        fileName,
        uploader ? `Uploaded ${date} by ${uploader}` : `Uploaded ${date}`,
        ...(rowCount === null ? [] : [rows(rowCount)]),
      ].join(' · '),
    matched: 'already in your constituents',
    added: 'new people added',
    needsInput: 'need your input',
    skipped: 'skipped',
    invalid: 'missing a first or last name',
    updated: 'updated people you imported before',
    unchanged: 'unchanged from your last upload',
    processing: "We're matching your people. This page updates when it's done.",
    failed: "This upload didn't finish. Try again.",
    tryAgain: 'Try again',
    retryFailed: "We couldn't restart this upload. Try again.",
    loadFailed: "We couldn't load this upload. Refresh the page to try again.",
  },
  review: {
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
    changeMatch: 'Change match',
    showMore: 'Show more rows',
    empty: 'No rows match your search. Try another name or email.',
    noRows: 'No rows were added from this file yet.',
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
  changeMatch: {
    title: 'Who is this person?',
    fromUpload: (uploadName: string) => `From ${uploadName}.`,
    whichUpload: 'Which upload is this from?',
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
    uploadRow: (uploadName: string, date: string) => `${uploadName}, ${date}`,
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
  history: {
    ...SERVE_IMPORT_CONTACTS_COPY.history,
    caption: 'Files you have imported for your campaign',
    backToContacts: `Back to ${CONTACTS_DATA_TITLE.win}`,
    emptyMessage: 'Import a file to add people to your campaign.',
  },
  detail: {
    ...SERVE_IMPORT_CONTACTS_COPY.detail,
    matched: 'already in your voter file',
  },
  processed: {
    ...SERVE_IMPORT_CONTACTS_COPY.processed,
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
        ? `Already in your voter file. Updated ${fieldList(changedFields)}.`
        : 'Already in your voter file.'
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
