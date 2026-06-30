'use client'

import { useState } from 'react'
import { Button, Card } from '@styleguide'
import { useQuery } from '@tanstack/react-query'
import {
  getUserWebsite,
  USER_WEBSITE_QUERY_KEY,
} from 'app/dashboard/website/util/website.util'
import { Website } from 'helpers/types'
import MotivationDialog from './MotivationDialog'

const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export default function MotivationCard(): React.JSX.Element {
  const { data: website } = useQuery<Website | null>({
    queryKey: USER_WEBSITE_QUERY_KEY,
    queryFn: getUserWebsite,
  })

  const [open, setOpen] = useState(false)

  const bioHtml = website?.content?.about?.bio || ''
  const bioText = stripHtml(bioHtml)

  return (
    <Card className="w-full max-w-[640px] gap-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-xl font-semibold text-foreground">
          Your motivation for running
        </h2>
        <Button size="small" onClick={() => setOpen(true)}>
          {bioText ? 'Edit' : 'Add'}
        </Button>
      </div>

      {bioText ? (
        <p className="m-0 whitespace-pre-line text-sm text-foreground">
          {bioText}
        </p>
      ) : (
        <p className="m-0 text-sm text-muted-foreground/60">Add Information</p>
      )}

      <MotivationDialog
        open={open}
        onOpenChange={setOpen}
        initialBio={bioHtml}
        onSaved={() => {}}
      />
    </Card>
  )
}
