'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@styleguide'
import { useQueryClient } from '@tanstack/react-query'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import {
  saveAboutFields,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { clientRequest } from 'gpApi/typed-request'
import { electedOfficeQueryOptions } from '@shared/hooks/useElectedOffice'
import { useOrganization } from '@shared/organization-picker'
import { isValidUrl } from 'helpers/linkhelper'
import { useSnackbar } from 'helpers/useSnackbar'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'

export interface AboutMeData {
  party: string
  bio: string
  occupation: string
  website: string
}

const PARTY_OPTIONS = [
  'Non-partisan',
  'Independent',
  'Green Party',
  'Libertarian Party',
  'Forward Party',
  'Other',
]

// Radix Select disallows an empty-string item value, so "None" uses a sentinel
// that maps back to an empty party (cleared) on change.
const NO_PARTY_VALUE = '__none__'

interface AboutMeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: AboutMeData
  // When true, the active org is an elected office: party is saved to the
  // elected-office record and the campaign-only fields are hidden.
  isElectedOffice?: boolean
  electedOfficeId?: string
  onSaved: (data: AboutMeData) => void
}

export default function AboutMeDialog({
  open,
  onOpenChange,
  data,
  isElectedOffice = false,
  electedOfficeId,
  onSaved,
}: AboutMeDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const organization = useOrganization()
  const { errorSnackbar } = useSnackbar()
  const [form, setForm] = useState<AboutMeData>(data)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(data)
  }, [open, data])

  const websiteInvalid =
    !isElectedOffice && !!form.website && !isValidUrl(form.website)
  const canSave = !websiteInvalid

  const handleSave = async (): Promise<void> => {
    if (!canSave || saving) return
    // The elected-office record may still be loading when the dialog opens.
    // Saving without its id would silently skip the party write, so block and
    // ask the user to retry rather than report a false success.
    if (isElectedOffice && !electedOfficeId) {
      errorSnackbar(
        'Your office is still loading. Please try again in a moment.',
      )
      return
    }
    trackEvent(EVENTS.Profile.CampaignDetails.ClickSave)
    setSaving(true)
    // Bio lives on the website's "about.bio" — the same field the website
    // builder and the public profile render. Party is stored on the elected
    // office for officeholders (with occupation/website omitted) and on the
    // campaign for candidates — each path writes only to the record it owns.
    let ok = false
    try {
      if (isElectedOffice) {
        const [officeRes, bioOk] = await Promise.all([
          electedOfficeId
            ? clientRequest('PUT /v1/elected-office/:id', {
                id: electedOfficeId,
                party: form.party || null,
              })
            : Promise.resolve({ ok: false }),
          saveAboutFields({ bio: form.bio }),
        ])
        ok = officeRes.ok && bioOk
        await queryClient.invalidateQueries({
          queryKey: electedOfficeQueryOptions(organization?.slug).queryKey,
        })
      } else {
        const [campaignRes, bioOk] = await Promise.all([
          updateCampaign([
            { key: 'details.party', value: form.party || null },
            { key: 'details.occupation', value: form.occupation },
            { key: 'details.website', value: form.website },
          ]),
          saveAboutFields({ bio: form.bio }),
        ])
        ok = campaignRes !== false && bioOk
      }
      await queryClient.invalidateQueries({ queryKey: USER_WEBSITE_QUERY_KEY })
    } catch {
      ok = false
    }
    setSaving(false)
    if (!ok) {
      // Keep the dialog open so the user can retry; don't show stale saved
      // values as if the write succeeded.
      errorSnackbar(
        'Something went wrong saving your details. Please try again.',
      )
      return
    }
    onSaved(form)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your details</DialogTitle>
          <DialogDescription>
            Update the details that appear on your public profile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="about-party">Party</Label>
            <Select
              value={form.party || NO_PARTY_VALUE}
              onValueChange={(v) =>
                setForm({ ...form, party: v === NO_PARTY_VALUE ? '' : v })
              }
            >
              <SelectTrigger id="about-party" className="w-full">
                <SelectValue placeholder="Select party" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARTY_VALUE}>None</SelectItem>
                {PARTY_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="about-bio">Bio</Label>
            <Textarea
              id="about-bio"
              placeholder="Share personal insights that illuminate who you are as an individual and a member of the community."
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              rows={5}
            />
          </div>

          {/* Occupation and Website are campaign fields with no elected-office
              equivalent, so they're hidden for officeholders. */}
          {!isElectedOffice && (
            <>
              <div className="space-y-2">
                <Label htmlFor="about-occupation">Occupation</Label>
                <Input
                  id="about-occupation"
                  placeholder="Add your occupation"
                  value={form.occupation}
                  onChange={(e) =>
                    setForm({ ...form, occupation: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="about-website">Website</Label>
                <Input
                  id="about-website"
                  placeholder="Add your website url"
                  value={form.website}
                  onChange={(e) =>
                    setForm({ ...form, website: e.target.value })
                  }
                  aria-invalid={websiteInvalid}
                />
                {websiteInvalid && (
                  <p className="m-0 text-sm text-destructive">
                    Please provide the full url starting with http:// or
                    https://
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave} loading={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
