'use client'

import { useEffect, useState } from 'react'
import { Button, Card } from '@styleguide'
import { useQuery } from '@tanstack/react-query'
import {
  getUserWebsite,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { useOrganization } from '@shared/organization-picker'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { Campaign, Website } from 'helpers/types'
import ReadField from './ReadField'
import AboutMeDialog, { AboutMeData } from './AboutMeDialog'

interface YourDetailsCardProps {
  campaign?: Campaign
}

const toData = (
  party: string,
  bio: string,
  campaign?: Campaign,
): AboutMeData => ({
  party,
  bio,
  occupation: campaign?.details?.occupation || '',
  website: campaign?.details?.website || '',
})

export default function YourDetailsCard({
  campaign,
}: YourDetailsCardProps): React.JSX.Element {
  const organization = useOrganization()
  const isElectedOffice = !!organization?.electedOfficeId
  const { data: electedOffice } = useElectedOffice()

  const { data: website } = useQuery<Website | null>({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
  })
  const serverBio = website?.content?.about?.content || ''
  // Party is stored on the elected office for officeholders and on the campaign
  // for candidates — the two records are independent, so neither path assumes
  // the other exists.
  const serverParty = isElectedOffice
    ? electedOffice?.party || ''
    : campaign?.details?.party || ''

  const [data, setData] = useState<AboutMeData>(
    toData(serverParty, serverBio, campaign),
  )
  const [open, setOpen] = useState(false)
  // Track whether the user has locally edited so a refetch doesn't clobber an
  // optimistic update.
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setData(toData(serverParty, serverBio, campaign))
  }, [serverParty, serverBio, campaign, dirty])

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-xl font-semibold text-foreground">
          Your details
        </h2>
        <Button variant="ghost" size="small" onClick={() => setOpen(true)}>
          Edit details
        </Button>
      </div>

      <ReadField label="Party" value={data.party} placeholder />
      <ReadField label="Bio" value={data.bio} placeholder />
      {/* Occupation and Website live on the campaign; an elected office has no
          equivalent fields, so they're candidate-only. */}
      {!isElectedOffice && (
        <>
          <ReadField label="Occupation" value={data.occupation} placeholder />
          <ReadField label="Website" value={data.website} placeholder />
        </>
      )}

      <AboutMeDialog
        open={open}
        onOpenChange={setOpen}
        data={data}
        isElectedOffice={isElectedOffice}
        electedOfficeId={electedOffice?.id}
        onSaved={(next) => {
          setDirty(true)
          setData(next)
        }}
      />
    </Card>
  )
}
