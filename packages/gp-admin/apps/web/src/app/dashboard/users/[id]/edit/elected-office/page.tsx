'use client'

import { useRouter } from 'next/navigation'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Flex, Button, Separator } from '@radix-ui/themes'
import { HiCheck, HiX } from 'react-icons/hi'
import { SuccessCallout } from '@/components/SuccessCallout'
import { useState } from 'react'
import { stubbedElectedOffice } from '@/data/stubbed-elected-office'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { electedOfficeSchema, type ElectedOfficeFormData } from '../schema'
import { ElectedOfficeForm } from '../components/ElectedOfficeForm'
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning'
import { FORM_MODE } from '../constants'

export default function EditElectedOfficePage() {
  const router = useRouter()
  const [saveSuccess, setSaveSuccess] = useState(false)

  const hasElectedOffice = stubbedCampaign.didWin === true
  const electedOffice = hasElectedOffice ? stubbedElectedOffice : null

  const form = useForm<ElectedOfficeFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(electedOfficeSchema),
    defaultValues: {
      electedDate: electedOffice?.electedDate ?? null,
      swornInDate: electedOffice?.swornInDate ?? null,
      termStartDate: electedOffice?.termStartDate ?? null,
      termLengthDays: electedOffice?.termLengthDays ?? null,
      termEndDate: electedOffice?.termEndDate ?? null,
      isActive: electedOffice?.isActive ?? true,
    },
  })

  useUnsavedChangesWarning(form.formState.isDirty)

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/elected-office`)
  }

  function handleSave() {
    const data = form.getValues()
    const result = electedOfficeSchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    console.log('[PATCH /elected-offices/:id] Saving:', data)

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  const { isDirty, isValid } = form.formState

  return (
    <>
      <SuccessCallout
        visible={saveSuccess}
        message="Changes saved (simulated)"
      />

      <FormProvider {...form}>
        <ElectedOfficeForm hasElectedOffice={hasElectedOffice} />
      </FormProvider>

      {hasElectedOffice && (
        <>
          <Separator size="4" my="6" />

          <Flex gap="3" justify="end">
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={handleCancel}
            >
              <HiX className="w-4 h-4" />
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!isValid || !isDirty}
            >
              <HiCheck className="w-4 h-4" />
              Save Changes
            </Button>
          </Flex>
        </>
      )}
    </>
  )
}
