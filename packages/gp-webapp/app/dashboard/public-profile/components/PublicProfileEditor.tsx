'use client'

import { useMemo, useRef, useState, type JSX } from 'react'
import Image from 'next/image'
import { Button, Card, Input, Label, Switch, Textarea } from '@styleguide'
import { UploadCloud } from 'lucide-react'
import type { Priority } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { reportErrorToSentry } from '@shared/sentry'
import type {
  PersonProfile,
  PersonProfileAccomplishment,
  PersonProfileRecentExperienceItem,
  UpsertPersonProfileRequest,
} from '../shared/types'
import type { PublicProfileProduct } from '../publicProfileAccess'
import DashboardNavHeaderAction from '../../shared/DashboardNavHeaderAction'
import { AccomplishmentsEditor, RecentExperienceEditor } from './ListEditors'
import PrioritiesPublicationEditor, {
  type PriorityRow,
} from './PrioritiesPublicationEditor'
import {
  FIELD_LABELS,
  fieldErrorsFromApiError,
  fieldLabel,
  normalizeUrl,
  summarize,
  URL_FIELDS,
  validateContact,
  type FieldErrors,
} from './publicProfileValidation'

const toNull = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// Row order is meaningful to the reader, so a reorder counts as a change.
const sameList = (a: unknown[], b: unknown[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

// Local, all-string mirror of the editable overlay surface (nulls become '').
interface FormState {
  displayName: string
  roleTitleOverride: string
  bioOverride: string
  whyRunning: string
  publicEmail: string
  publicPhone: string
  officePhone: string
  websiteUrl: string
  governmentWebsiteUrl: string
  instagramUrl: string
  tiktokUrl: string
  facebookUrl: string
  twitterUrl: string
  linkedinUrl: string
}

// Exported so a test can hold the label map to the same set: a field added here
// without a label reports as its column name when the server rejects it.
export const FORM_KEYS = [
  'displayName',
  'roleTitleOverride',
  'bioOverride',
  'whyRunning',
  'publicEmail',
  'publicPhone',
  'officePhone',
  'websiteUrl',
  'governmentWebsiteUrl',
  'instagramUrl',
  'tiktokUrl',
  'facebookUrl',
  'twitterUrl',
  'linkedinUrl',
] as const satisfies readonly (keyof FormState)[]

const toForm = (p: PersonProfile): FormState => ({
  displayName: p.displayName ?? '',
  roleTitleOverride: p.roleTitleOverride ?? '',
  bioOverride: p.bioOverride ?? '',
  whyRunning: p.whyRunning ?? '',
  publicEmail: p.publicEmail ?? '',
  publicPhone: p.publicPhone ?? '',
  officePhone: p.officePhone ?? '',
  websiteUrl: p.websiteUrl ?? '',
  governmentWebsiteUrl: p.governmentWebsiteUrl ?? '',
  instagramUrl: p.instagramUrl ?? '',
  tiktokUrl: p.tiktokUrl ?? '',
  facebookUrl: p.facebookUrl ?? '',
  twitterUrl: p.twitterUrl ?? '',
  linkedinUrl: p.linkedinUrl ?? '',
})

const buildPriorityRows = (
  priorities: Priority[],
  profile: PersonProfile,
): PriorityRow[] => {
  const overlay = new Map(profile.issues.map((i) => [i.issueId, i]))
  const sorted = [...priorities].sort((a, b) => {
    const ao = overlay.get(a.id)?.sortOrder ?? Number.MAX_SAFE_INTEGER
    const bo = overlay.get(b.id)?.sortOrder ?? Number.MAX_SAFE_INTEGER
    return ao - bo
  })
  return sorted.map((priority) => {
    const existing = overlay.get(priority.id)
    return {
      issueId: priority.id,
      title: priority.title,
      description: priority.description,
      // Default new priorities to hidden — publishing is an explicit choice.
      visible: existing?.visible ?? false,
      status: existing?.status ?? null,
    }
  })
}

export default function PublicProfileEditor({
  product,
  initialProfile,
  canCreate,
  priorities,
}: {
  product: PublicProfileProduct
  initialProfile: PersonProfile | null
  canCreate: boolean
  priorities: Priority[]
}): JSX.Element {
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [profile, setProfile] = useState<PersonProfile | null>(initialProfile)
  const [creating, setCreating] = useState(false)

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        {/* No heading: the page title bar (DashboardLayout's navHeader) is the
            page's title, so a card heading would just repeat the tab name. */}
        <Card className="flex flex-col gap-4 p-6">
          {canCreate ? (
            <>
              <p className="text-gray-600">
                Create your public profile to control what appears on your
                goodparty.org/people page — your bio, priorities, and contact
                info.
              </p>
              <Button
                className="self-start"
                loading={creating}
                loadingText="Creating…"
                onClick={async () => {
                  setCreating(true)
                  try {
                    const { data } = await clientRequest(
                      'POST /v1/person-profiles',
                      {},
                    )
                    setProfile(data)
                    successSnackbar('Public profile created.')
                  } catch (err) {
                    reportErrorToSentry(err, {
                      context: 'PublicProfileEditor.create',
                    })
                    errorSnackbar("Couldn't create your profile. Try again.")
                  } finally {
                    setCreating(false)
                  }
                }}
              >
                Create my public profile
              </Button>
            </>
          ) : (
            <p className="text-gray-600">
              We&apos;re still setting up your official record. Your public
              profile editor will unlock automatically once it&apos;s ready —
              usually within a day or two.
            </p>
          )}
        </Card>
      </div>
    )
  }

  return (
    <LoadedEditor
      product={product}
      profile={profile}
      priorities={priorities}
      onProfile={setProfile}
    />
  )
}

function LoadedEditor({
  product,
  profile,
  priorities,
  onProfile,
}: {
  product: PublicProfileProduct
  profile: PersonProfile
  priorities: Priority[]
  onProfile: (p: PersonProfile) => void
}): JSX.Element {
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [form, setForm] = useState<FormState>(() => toForm(profile))
  // Which fields the owner actually edited. Membership here, not a value
  // comparison, is what makes a field eligible to be sent: normalizing adds
  // `https://` to a scheme-less link, so comparing a normalized form against a
  // raw baseline would make a stored `instagram.com/jane` look edited and drag
  // it into a save the owner never asked for.
  const [touched, setTouched] = useState<ReadonlySet<keyof FormState>>(
    () => new Set(),
  )
  // Last known server state. Saves send only what differs from this, so a field
  // this editor never touched cannot be overwritten by a stale snapshot — the
  // form is captured once at mount and is not otherwise reconciled.
  const [baseline, setBaseline] = useState<FormState>(() => toForm(profile))
  const [baselineLists, setBaselineLists] = useState(() => ({
    recentExperience: profile.recentExperience ?? [],
    accomplishments: profile.accomplishments ?? [],
  }))
  const [experience, setExperience] = useState<
    PersonProfileRecentExperienceItem[]
  >(profile.recentExperience ?? [])
  const [accomplishments, setAccomplishments] = useState<
    PersonProfileAccomplishment[]
  >(profile.accomplishments ?? [])
  const [priorityRows, setPriorityRows] = useState<PriorityRow[]>(() =>
    buildPriorityRows(priorities, profile),
  )
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [savingIssues, setSavingIssues] = useState(false)
  const [togglingPublish, setTogglingPublish] = useState(false)
  const [uploading, setUploading] = useState<'avatar' | null>(null)

  const avatarInputRef = useRef<HTMLInputElement>(null)

  const isPublished = Boolean(profile.publishedAt) && !profile.deletedAt

  const setField = (key: keyof FormState, value: string): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    // Clear as they type, so the message tracks the field's current contents
    // rather than lingering from the last attempt.
    setErrors((prev) => {
      if (prev[key] === undefined) return prev
      const { [key]: _fixed, ...rest } = prev
      return rest
    })
  }

  // On blur rather than at save time, so the `https://` that will actually be
  // stored is visible while they are still looking at the field. Only for a
  // field they edited — merely tabbing through a stored link must not rewrite
  // it, or the displayed value stops matching what is on the server.
  const normalizeUrlField = (key: keyof FormState): void => {
    if (!touched.has(key)) return
    setForm((prev) => ({ ...prev, [key]: normalizeUrl(prev[key]) }))
  }

  const handleSave = async (): Promise<void> => {
    // Blur normally does this first; repeated here for a save triggered without
    // one, and confined to edited fields for the same reason blur is.
    const normalized: FormState = { ...form }
    for (const key of URL_FIELDS) {
      if (touched.has(key)) normalized[key] = normalizeUrl(normalized[key])
    }
    setForm(normalized)

    // Only what the owner edited, and only where it actually differs. Sending
    // the whole form made every save a last-write-wins overwrite of a
    // mount-time snapshot, so editing one section silently blanked anything set
    // elsewhere since the page loaded.
    const changed = FORM_KEYS.filter(
      (key) => touched.has(key) && normalized[key] !== baseline[key],
    )

    // Validated per changed field rather than over the whole form. The columns
    // carry no DB constraint, so a value the rule would reject can be stored by
    // any path that skips the schema; validating the whole form would let such
    // a value block edits to every other field, with no way for the owner to
    // clear it. It is not being sent, so it is not our business here. A
    // malformed *edit* still withholds the request, since the server would
    // reject the payload and retrying could never succeed.
    const invalid = validateContact(
      Object.fromEntries(changed.map((key) => [key, normalized[key]])),
    )
    const [firstInvalid] = Object.keys(invalid)
    if (firstInvalid !== undefined) {
      setErrors(invalid)
      errorSnackbar(summarize(invalid, product))
      document.getElementById(firstInvalid)?.focus()
      return
    }

    const body: UpsertPersonProfileRequest = {}
    for (const key of changed) body[key] = toNull(normalized[key])
    const nextExperience = experience.filter((r) => r.title.trim() !== '')
    if (!sameList(nextExperience, baselineLists.recentExperience)) {
      body.recentExperience = nextExperience
    }
    const nextAccomplishments = accomplishments.filter(
      (r) => r.title.trim() !== '',
    )
    if (!sameList(nextAccomplishments, baselineLists.accomplishments)) {
      body.accomplishments = nextAccomplishments
    }

    // Ahead of the no-op check rather than after it: a fresh attempt supersedes
    // the last one's errors whether or not it turns out to have anything to
    // send, and that shouldn't rest on an argument about which states are
    // reachable.
    setErrors({})

    if (Object.keys(body).length === 0) {
      successSnackbar('No changes to save.')
      return
    }

    setSaving(true)
    try {
      const { data } = await clientRequest('PUT /v1/person-profiles/mine', body)
      onProfile(data)
      setBaseline(toForm(data))
      setTouched(new Set())
      setBaselineLists({
        recentExperience: data.recentExperience ?? [],
        accomplishments: data.accomplishments ?? [],
      })
      successSnackbar('Profile saved.')
    } catch (err) {
      reportErrorToSentry(err, { context: 'PublicProfileEditor.save' })
      // The rejection body names the field it refused; showing that beats
      // asking someone to retry a value the server will never accept.
      const fieldErrors = fieldErrorsFromApiError(err)
      setErrors(fieldErrors)
      errorSnackbar(summarize(fieldErrors, product))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveIssues = async (): Promise<void> => {
    setSavingIssues(true)
    try {
      const { data } = await clientRequest(
        'PUT /v1/person-profiles/mine/issues',
        {
          issues: priorityRows.map((row, index) => ({
            issueId: row.issueId,
            visible: row.visible,
            status: row.status,
            sortOrder: index,
          })),
        },
      )
      onProfile(data)
      successSnackbar('Priorities updated.')
    } catch (err) {
      reportErrorToSentry(err, { context: 'PublicProfileEditor.saveIssues' })
      errorSnackbar("Couldn't update your priorities. Please try again.")
    } finally {
      setSavingIssues(false)
    }
  }

  const handleTogglePublish = async (next: boolean): Promise<void> => {
    setTogglingPublish(true)
    try {
      const { data } = await clientRequest(
        next
          ? 'POST /v1/person-profiles/mine/publish'
          : 'POST /v1/person-profiles/mine/unpublish',
        {},
      )
      onProfile(data)
      successSnackbar(next ? 'Profile published.' : 'Profile unpublished.')
    } catch (err) {
      reportErrorToSentry(err, { context: 'PublicProfileEditor.publish' })
      errorSnackbar("Couldn't update publish status. Please try again.")
    } finally {
      setTogglingPublish(false)
    }
  }

  const handleUpload = async (
    target: 'avatar',
    file: File | undefined,
  ): Promise<void> => {
    if (!file) return
    setUploading(target)
    try {
      const formData = new FormData()
      formData.append('file', file, file.name)
      const { data } = await clientRequest(
        'POST /v1/person-profiles/mine/upload-image',
        {},
        { body: formData, query: { target } },
      )
      onProfile(data)
      successSnackbar('Image uploaded.')
    } catch (err) {
      reportErrorToSentry(err, { context: 'PublicProfileEditor.upload' })
      errorSnackbar("Couldn't upload that image. Please try again.")
    } finally {
      setUploading(null)
    }
  }

  const contactFields = useMemo(
    () =>
      (
        [
          ['publicEmail', 'you@example.com'],
          ['publicPhone', '(555) 123-4567'],
          ['officePhone', '(555) 987-6543'],
          ['websiteUrl', 'https://…'],
          ['governmentWebsiteUrl', 'https://…'],
          ['instagramUrl', 'https://instagram.com/…'],
          ['tiktokUrl', 'https://tiktok.com/@…'],
          ['facebookUrl', 'https://facebook.com/…'],
          ['twitterUrl', 'https://x.com/…'],
          ['linkedinUrl', 'https://linkedin.com/in/…'],
        ] as const
      ).map(([key, placeholder]) => ({
        key,
        label: FIELD_LABELS[key],
        placeholder,
      })),
    [],
  )

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      {/* Publish state + Save are the page's primary actions, so they sit top
          right in the title bar (DashboardLayout's navHeader), which is also
          the page's h1 — hence no in-page "Public profile" heading here. */}
      <DashboardNavHeaderAction>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            data-testid="publish-toggle"
            checked={isPublished}
            disabled={togglingPublish}
            onCheckedChange={handleTogglePublish}
          />
          {isPublished ? 'Published' : 'Draft'}
        </label>
        <Button
          size="small"
          onClick={handleSave}
          loading={saving}
          loadingText="Saving…"
        >
          Save changes
        </Button>
      </DashboardNavHeaderAction>
      <p className="text-sm text-gray-500">
        Everything here is visible on your goodparty.org/people page.
      </p>

      {/* Identity */}
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Identity</h2>
        <div className="flex flex-wrap items-center gap-6">
          <ImageUploader
            label="Profile photo"
            url={profile.avatarUrl}
            busy={uploading === 'avatar'}
            inputRef={avatarInputRef}
            onFile={(f) => handleUpload('avatar', f)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="displayName"
            label={FIELD_LABELS.displayName}
            hint="Overrides the name from public records."
            value={form.displayName}
            placeholder="Jane Doe"
            error={errors.displayName}
            onChange={(v) => setField('displayName', v)}
          />
          <Field
            id="roleTitleOverride"
            label={FIELD_LABELS.roleTitleOverride}
            value={form.roleTitleOverride}
            placeholder="City Council Member, Ward 3"
            error={errors.roleTitleOverride}
            onChange={(v) => setField('roleTitleOverride', v)}
          />
        </div>
      </Card>

      {/* About */}
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">About</h2>
        <TextareaField
          id="bioOverride"
          label={FIELD_LABELS.bioOverride}
          rows={5}
          value={form.bioOverride}
          placeholder="Tell people who you are and what you care about."
          error={errors.bioOverride}
          onChange={(v) => setField('bioOverride', v)}
        />
        <TextareaField
          id="whyRunning"
          label={fieldLabel('whyRunning', product)}
          rows={4}
          value={form.whyRunning}
          placeholder={
            product === 'serve'
              ? 'What drives your work in office.'
              : "What you'll fight for and why."
          }
          error={errors.whyRunning}
          onChange={(v) => setField('whyRunning', v)}
        />
      </Card>

      {/* Top Priorities (Serve only — Win campaign issues live on the website) */}
      {product === 'serve' && (
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Top priorities</h2>
            <Button
              variant="outline"
              size="small"
              onClick={handleSaveIssues}
              loading={savingIssues}
              loadingText="Saving…"
            >
              Save priorities
            </Button>
          </div>
          <p className="text-sm text-gray-500">
            Choose which of your priorities appear publicly, their order, and
            their live status.
          </p>
          <PrioritiesPublicationEditor
            rows={priorityRows}
            onChange={setPriorityRows}
            disabled={savingIssues}
          />
        </Card>
      )}

      {/* Recent Experience */}
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Recent experience</h2>
        <RecentExperienceEditor
          value={experience}
          onChange={setExperience}
          disabled={saving}
        />
      </Card>

      {/* Accomplishments */}
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Accomplishments</h2>
        <AccomplishmentsEditor
          value={accomplishments}
          onChange={setAccomplishments}
          disabled={saving}
        />
      </Card>

      {/* Contact */}
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Contact & links</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {contactFields.map(({ key, label, placeholder }) => (
            <Field
              key={key}
              id={key}
              label={label}
              value={form[key]}
              placeholder={placeholder}
              error={errors[key]}
              onChange={(v) => setField(key, v)}
              onBlur={
                (URL_FIELDS as readonly string[]).includes(key)
                  ? () => normalizeUrlField(key)
                  : undefined
              }
            />
          ))}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving} loadingText="Saving…">
          Save changes
        </Button>
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  value,
  placeholder,
  hint,
  error,
  onChange,
  onBlur,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  hint?: string
  error?: string
  onChange: (value: string) => void
  onBlur?: () => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {error !== undefined ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-gray-500">{hint}</p>
      )}
    </div>
  )
}

/**
 * `Field`'s multi-line counterpart. The server can reject a bio or a why-running
 * as readily as an email, and the snackbar naming it goes away — without this
 * the only lasting record of which box to fix was a toast the owner may have
 * already dismissed.
 */
function TextareaField({
  id,
  label,
  value,
  rows,
  placeholder,
  error,
  onChange,
}: {
  id: string
  label: string
  value: string
  rows: number
  placeholder?: string
  error?: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== undefined && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

function ImageUploader({
  label,
  url,
  busy,
  inputRef,
  onFile,
}: {
  label: string
  url: string | null
  busy: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-20 w-20 overflow-hidden rounded-full border border-gray-200 bg-gray-50">
        {url && (
          <Image
            src={url}
            alt={label}
            fill
            className="object-cover"
            unoptimized
          />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="small"
        loading={busy}
        loadingText="Uploading…"
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className="mr-1 h-4 w-4" /> {label}
      </Button>
    </div>
  )
}
