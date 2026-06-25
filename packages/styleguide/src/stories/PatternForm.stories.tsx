'use client'

import * as React from 'react'
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Label } from '../components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
import { RadioGroup, RadioGroupItemLabel } from '../components/ui/radio-group'
import { Checkbox } from '../components/ui/checkbox'
import { Switch } from '../components/ui/switch'
import { Button } from '../components/ui/button'
import { Combobox } from '../components/ui/combobox'

const meta: Meta = {
  title: 'Patterns/Form',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A reference composition showing all input components together in a realistic form layout. Use this to verify visual coherence across Input, Textarea, Select, Combobox, RadioGroup, Checkbox, and Switch.',
      },
    },
  },
}

export default meta
type Story = StoryObj

type District = { value: string; label: string }
const DISTRICTS: District[] = [
  { value: 'district-1', label: 'District 1' },
  { value: 'district-2', label: 'District 2' },
  { value: 'district-3', label: 'District 3' },
  { value: 'district-4', label: 'District 4' },
  { value: 'district-5', label: 'District 5' },
]

export const CandidateProfile: Story = {
  parameters: { controls: { disable: true } },
  render: () => {
    const Demo = () => {
      const [name, setName] = useState('')
      const [bio, setBio] = useState('')
      const [party, setParty] = useState('independent')
      const [officeLevel, setOfficeLevel] = useState('')
      const [district, setDistrict] = useState<District | null>(null)
      const [notifyEmail, setNotifyEmail] = useState(true)
      const [termsAccepted, setTermsAccepted] = useState(false)

      return (
        <form
          className="w-full max-w-lg space-y-6"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bio">Campaign bio</Label>
            <Textarea
              id="bio"
              placeholder="Tell voters about yourself..."
              rows={4}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Shown on your public campaign page.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="office-level">Office level</Label>
            <Select value={officeLevel} onValueChange={setOfficeLevel}>
              <SelectTrigger id="office-level" className="w-full">
                <SelectValue placeholder="Select an office level" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="city">City</SelectItem>
                  <SelectItem value="county">County</SelectItem>
                  <SelectItem value="state">State</SelectItem>
                  <SelectItem value="federal">Federal</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="district">District</Label>
            <Combobox
              id="district"
              options={DISTRICTS}
              value={district}
              onChange={setDistrict}
              getOptionLabel={(d) => d.label}
              getOptionKey={(d) => d.value}
              placeholder="Search districts..."
              searchPlaceholder="Type to search..."
            />
          </div>

          <div className="grid gap-2">
            <Label>Party affiliation</Label>
            <RadioGroup value={party} onValueChange={setParty}>
              <RadioGroupItemLabel
                value="independent"
                id="party-independent"
                label="Independent"
              />
              <RadioGroupItemLabel
                value="democrat"
                id="party-democrat"
                label="Democrat"
              />
              <RadioGroupItemLabel
                value="republican"
                id="party-republican"
                label="Republican"
              />
            </RadioGroup>
          </div>

          <div className="grid gap-3">
            <Label>Notifications</Label>
            <div className="flex items-center gap-3">
              <Switch
                id="notify-email"
                checked={notifyEmail}
                onCheckedChange={setNotifyEmail}
              />
              <Label
                htmlFor="notify-email"
                variant="secondary"
                className="cursor-pointer"
              >
                Email me about campaign updates
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="terms"
                checked={termsAccepted}
                onCheckedChange={(v) => setTermsAccepted(Boolean(v))}
                className="mt-0.5"
              />
              <Label
                htmlFor="terms"
                variant="secondary"
                className="cursor-pointer leading-5"
              >
                I agree to the{' '}
                <span className="text-primary underline">terms of service</span>{' '}
                and privacy policy
              </Label>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={!termsAccepted}>
            Save profile
          </Button>
        </form>
      )
    }
    return <Demo />
  },
}
