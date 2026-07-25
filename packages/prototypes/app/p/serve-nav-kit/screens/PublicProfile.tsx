'use client'

import { Eye, FileDown } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  Card,
  IconButton,
  Input,
  Label,
  Switch,
  Textarea,
} from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'
import { ImageUploadField } from '../components/ImageUploadField'

const Field = ({
  label,
  defaultValue,
}: {
  label: string
  defaultValue: string
}) => (
  <div className="space-y-1.5">
    <Label>{label}</Label>
    <Input defaultValue={defaultValue} />
  </div>
)

export const PublicProfile = () => (
  <ScreenLayout
    title="Public Profile"
    aiPlaceholder="Hi Renee, how can I help?"
  >
    <div className="flex items-center justify-end gap-2">
      <IconButton variant="ghost" size="small" aria-label="Preview">
        <Eye className="size-5" />
      </IconButton>
      <IconButton variant="ghost" size="small" aria-label="Export">
        <FileDown className="size-5" />
      </IconButton>
      <div className="flex items-center gap-2">
        <Switch defaultChecked id="published" />
        <Label htmlFor="published">Published</Label>
      </div>
    </div>

    <Card className="gap-5 p-5">
      <div className="space-y-1">
        <h2 className="text-foreground text-lg font-semibold">Identity</h2>
        <p className="text-muted-foreground text-sm">
          How your name, photo, and cover appear on your public profile.
        </p>
      </div>

      <ImageUploadField
        label="Cover image"
        buttonLabel="Upload cover"
        preview={<div className="bg-muted h-28 w-full rounded-xl" />}
      />

      <ImageUploadField
        label="Profile photo"
        buttonLabel="Upload photo"
        preview={
          <Avatar className="size-16">
            <AvatarFallback className="text-lg font-semibold">
              RC
            </AvatarFallback>
          </Avatar>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" defaultValue="Renee Carter" />
        <Field
          label="Role or title"
          defaultValue="City Council, City of Maplewood"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Initials</Label>
          <Input defaultValue="RC" />
          <p className="text-muted-foreground text-xs">
            Shown when no profile photo is set.
          </p>
        </div>
      </div>
    </Card>

    <Card className="gap-3 p-5">
      <div className="space-y-1">
        <h2 className="text-foreground text-lg font-semibold">Bio</h2>
        <p className="text-muted-foreground text-sm">
          Your background and platform statement.
        </p>
      </div>
      <Textarea
        rows={5}
        defaultValue="I grew up in Maplewood and spent fifteen years running a small business on Main Street. I'm running for City Council to focus on the practical fixes that make daily life easier and safer."
      />
      <span className="text-muted-foreground self-end text-xs">832 / 4000</span>
    </Card>
  </ScreenLayout>
)
