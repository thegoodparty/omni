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
import { AccomplishmentsEditor, RecentExperienceEditor } from './ListEditors'
import PrioritiesPublicationEditor, {
  type PriorityRow,
} from './PrioritiesPublicationEditor'

const toNull = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

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
        <Card className="flex flex-col gap-4 p-6">
          <h1 className="text-2xl font-semibold">Your public profile</h1>
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
  const [experience, setExperience] = useState<
    PersonProfileRecentExperienceItem[]
  >(profile.recentExperience ?? [])
  const [accomplishments, setAccomplishments] = useState<
    PersonProfileAccomplishment[]
  >(profile.accomplishments ?? [])
  const [priorityRows, setPriorityRows] = useState<PriorityRow[]>(() =>
    buildPriorityRows(priorities, profile),
  )
  const [saving, setSaving] = useState(false)
  const [savingIssues, setSavingIssues] = useState(false)
  const [togglingPublish, setTogglingPublish] = useState(false)
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null)

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const isPublished = Boolean(profile.publishedAt) && !profile.deletedAt

  const setField = (key: keyof FormState, value: string): void =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const body: UpsertPersonProfileRequest = {
        displayName: toNull(form.displayName),
        roleTitleOverride: toNull(form.roleTitleOverride),
        bioOverride: toNull(form.bioOverride),
        whyRunning: toNull(form.whyRunning),
        publicEmail: toNull(form.publicEmail),
        publicPhone: toNull(form.publicPhone),
        officePhone: toNull(form.officePhone),
        websiteUrl: toNull(form.websiteUrl),
        governmentWebsiteUrl: toNull(form.governmentWebsiteUrl),
        instagramUrl: toNull(form.instagramUrl),
        tiktokUrl: toNull(form.tiktokUrl),
        facebookUrl: toNull(form.facebookUrl),
        twitterUrl: toNull(form.twitterUrl),
        linkedinUrl: toNull(form.linkedinUrl),
        recentExperience: experience.filter((r) => r.title.trim() !== ''),
        accomplishments: accomplishments.filter((r) => r.title.trim() !== ''),
      }
      const { data } = await clientRequest('PUT /v1/person-profiles/mine', body)
      onProfile(data)
      successSnackbar('Profile saved.')
    } catch (err) {
      reportErrorToSentry(err, { context: 'PublicProfileEditor.save' })
      errorSnackbar("Couldn't save your profile. Please try again.")
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
    target: 'avatar' | 'cover',
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
      [
        ['publicEmail', 'Public email', 'you@example.com'],
        ['publicPhone', 'Phone', '(555) 123-4567'],
        ['officePhone', 'Office phone', '(555) 987-6543'],
        ['websiteUrl', 'Personal website', 'https://…'],
        ['governmentWebsiteUrl', 'Government website', 'https://…'],
        ['instagramUrl', 'Instagram', 'https://instagram.com/…'],
        ['tiktokUrl', 'TikTok', 'https://tiktok.com/@…'],
        ['facebookUrl', 'Facebook', 'https://facebook.com/…'],
        ['twitterUrl', 'X / Twitter', 'https://x.com/…'],
        ['linkedinUrl', 'LinkedIn', 'https://linkedin.com/in/…'],
      ] as Array<[keyof FormState, string, string]>,
    [],
  )

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      {/* Header + publish */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Public profile</h1>
          <p className="text-sm text-gray-500">
            Everything here is visible on your goodparty.org/people page.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch
              checked={isPublished}
              disabled={togglingPublish}
              onCheckedChange={handleTogglePublish}
            />
            {isPublished ? 'Published' : 'Draft'}
          </label>
          <Button onClick={handleSave} loading={saving} loadingText="Saving…">
            Save changes
          </Button>
        </div>
      </div>

      {/* Identity */}
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Identity</h2>
        <div className="flex flex-wrap items-center gap-6">
          <ImageUploader
            label="Profile photo"
            shape="circle"
            url={profile.avatarUrl}
            busy={uploading === 'avatar'}
            inputRef={avatarInputRef}
            onFile={(f) => handleUpload('avatar', f)}
          />
          <ImageUploader
            label="Cover image"
            shape="wide"
            url={profile.coverImageUrl}
            busy={uploading === 'cover'}
            inputRef={coverInputRef}
            onFile={(f) => handleUpload('cover', f)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="displayName"
            label="Display name"
            hint="Overrides the name from public records."
            value={form.displayName}
            placeholder="Jane Doe"
            onChange={(v) => setField('displayName', v)}
          />
          <Field
            id="roleTitleOverride"
            label="Role / title"
            value={form.roleTitleOverride}
            placeholder="City Council Member, Ward 3"
            onChange={(v) => setField('roleTitleOverride', v)}
          />
        </div>
      </Card>

      {/* About */}
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">About</h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bioOverride">About me</Label>
          <Textarea
            id="bioOverride"
            rows={5}
            value={form.bioOverride}
            placeholder="Tell people who you are and what you care about."
            onChange={(e) => setField('bioOverride', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="whyRunning">
            {product === 'serve' ? 'Why I serve' : "Why I'm running"}
          </Label>
          <Textarea
            id="whyRunning"
            rows={4}
            value={form.whyRunning}
            placeholder={
              product === 'serve'
                ? 'What drives your work in office.'
                : "What you'll fight for and why."
            }
            onChange={(e) => setField('whyRunning', e.target.value)}
          />
        </div>
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
          {contactFields.map(([key, label, placeholder]) => (
            <Field
              key={key}
              id={key}
              label={label}
              value={form[key]}
              placeholder={placeholder}
              onChange={(v) => setField(key, v)}
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
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  hint?: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

function ImageUploader({
  label,
  shape,
  url,
  busy,
  inputRef,
  onFile,
}: {
  label: string
  shape: 'circle' | 'wide'
  url: string | null
  busy: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
}): JSX.Element {
  const box =
    shape === 'circle' ? 'h-20 w-20 rounded-full' : 'h-20 w-36 rounded-lg'
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`relative overflow-hidden border border-gray-200 bg-gray-50 ${box}`}
      >
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
