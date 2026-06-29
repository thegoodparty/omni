'use client'

import { useState } from 'react'
import { z } from 'zod'
import { Button, Card, Input, Label, Textarea } from '@styleguide'

// The gp-api start route derives the research inputs from the campaign record
// server-side and takes no body, so this form is the candidate-facing intake /
// confirmation step: it gathers and confirms the identity + footprint before
// kicking off the (paid) pass. The fields mirror what the agent works from.
const IntakeSchema = z.object({
  fullName: z.string().trim().min(1, 'Your full name is required.'),
  office: z
    .string()
    .trim()
    .min(1, 'The office you are running for is required.'),
  district: z
    .string()
    .trim()
    .min(1, 'Your district or jurisdiction is required.'),
  priorRoles: z.string().trim().optional(),
  links: z.string().trim().optional(),
})

export type SelfResearchIntake = z.infer<typeof IntakeSchema>

type FieldErrors = Partial<Record<keyof SelfResearchIntake, string>>

type Props = {
  initialValues?: Partial<SelfResearchIntake>
  submitting: boolean
  onSubmit: (values: SelfResearchIntake) => void
}

const SelfResearchIntakeForm = ({
  initialValues,
  submitting,
  onSubmit,
}: Props): React.JSX.Element => {
  const [fullName, setFullName] = useState(initialValues?.fullName ?? '')
  const [office, setOffice] = useState(initialValues?.office ?? '')
  const [district, setDistrict] = useState(initialValues?.district ?? '')
  const [priorRoles, setPriorRoles] = useState(initialValues?.priorRoles ?? '')
  const [links, setLinks] = useState(initialValues?.links ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const parsed = IntakeSchema.safeParse({
      fullName,
      office,
      district,
      priorRoles,
      links,
    })
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !(key in fieldErrors)) {
          fieldErrors[key as keyof SelfResearchIntake] = issue.message
        }
      }
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    onSubmit(parsed.data)
  }

  return (
    <Card className="p-6">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="self-research-full-name">Full name</Label>
          <Input
            id="self-research-full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            aria-invalid={Boolean(errors.fullName)}
            placeholder="Jane Candidate"
          />
          {errors.fullName && (
            <p className="text-sm text-destructive">{errors.fullName}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="self-research-office">
            Office you are running for
          </Label>
          <Input
            id="self-research-office"
            value={office}
            onChange={(e) => setOffice(e.target.value)}
            aria-invalid={Boolean(errors.office)}
            placeholder="City Council"
          />
          {errors.office && (
            <p className="text-sm text-destructive">{errors.office}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="self-research-district">
            District or jurisdiction
          </Label>
          <Input
            id="self-research-district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            aria-invalid={Boolean(errors.district)}
            placeholder="District 4, Springfield"
          />
          {errors.district && (
            <p className="text-sm text-destructive">{errors.district}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="self-research-prior-roles">
            Prior roles{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Textarea
            id="self-research-prior-roles"
            value={priorRoles}
            onChange={(e) => setPriorRoles(e.target.value)}
            placeholder="School board member 2018-2022, small business owner"
            className="min-h-20"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="self-research-links">
            Links to your site, social, or coverage{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Textarea
            id="self-research-links"
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder="One per line: your website, social profiles, news coverage"
            className="min-h-20"
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={submitting} loadingText="Starting…">
            Run self-research
          </Button>
        </div>
      </form>
    </Card>
  )
}

export default SelfResearchIntakeForm
