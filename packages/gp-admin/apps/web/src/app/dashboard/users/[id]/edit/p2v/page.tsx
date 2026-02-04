'use client'

import { useRouter } from 'next/navigation'
import { useForm, Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Flex, Button, Separator, Callout } from '@radix-ui/themes'
import { HiCheck, HiX } from 'react-icons/hi'
import { useState, useEffect } from 'react'
import { stubbedPathToVictory } from '@/data/stubbed-p2v'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import {
  pathToVictorySchema,
  P2V_STATUS,
  type PathToVictoryFormData,
} from '../schema'
import { P2VForm } from '../components/P2VForm'
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning'

export default function EditP2VPage() {
  const router = useRouter()
  const [saveSuccess, setSaveSuccess] = useState(false)
  const p2v = stubbedPathToVictory

  const form = useForm<PathToVictoryFormData>({
    mode: 'onChange',
    resolver: zodResolver(
      pathToVictorySchema
    ) as Resolver<PathToVictoryFormData>,
    defaultValues: {
      p2vStatus: p2v?.data?.p2vStatus as
        | (typeof P2V_STATUS)[number]
        | undefined,
      electionType: p2v?.data?.electionType ?? '',
      electionLocation: p2v?.data?.electionLocation ?? '',
      winNumber: p2v?.data?.winNumber ? Number(p2v.data.winNumber) : undefined,
      voterContactGoal: p2v?.data?.voterContactGoal
        ? Number(p2v.data.voterContactGoal)
        : undefined,
      totalRegisteredVoters: p2v?.data?.totalRegisteredVoters ?? undefined,
      projectedTurnout: p2v?.data?.projectedTurnout ?? undefined,
      averageTurnout: p2v?.data?.averageTurnout ?? undefined,
      republicans: p2v?.data?.republicans ?? undefined,
      democrats: p2v?.data?.democrats ?? undefined,
      indies: p2v?.data?.indies ?? undefined,
      men: p2v?.data?.men ?? undefined,
      women: p2v?.data?.women ?? undefined,
      white: p2v?.data?.white ?? undefined,
      asian: p2v?.data?.asian ?? undefined,
      africanAmerican: p2v?.data?.africanAmerican ?? undefined,
      hispanic: p2v?.data?.hispanic ?? undefined,
      viability: {
        level: p2v?.data?.viability?.level ?? '',
        isPartisan: p2v?.data?.viability?.isPartisan ?? false,
        isIncumbent: p2v?.data?.viability?.isIncumbent === 'true',
        isUncontested: p2v?.data?.viability?.isUncontested === 'true',
        candidates: p2v?.data?.viability?.candidates
          ? Number(p2v.data.viability.candidates)
          : undefined,
        seats: p2v?.data?.viability?.seats ?? undefined,
        candidatesPerSeat: p2v?.data?.viability?.candidatesPerSeat
          ? Number(p2v.data.viability.candidatesPerSeat)
          : undefined,
        score: p2v?.data?.viability?.score ?? undefined,
        probOfWin: undefined,
      },
    },
  })

  useUnsavedChangesWarning(form.formState.isDirty)

  // Debug: Log dirty state and which fields are dirty
  useEffect(() => {
    const defaultVals = form.formState.defaultValues
    const currentVals = form.getValues()
    console.log('[P2V Form Debug]', {
      isDirty: form.formState.isDirty,
      dirtyFields: form.formState.dirtyFields,
    })
    // Deep compare each field
    if (defaultVals) {
      Object.keys(currentVals).forEach((key) => {
        const defaultVal = defaultVals[key as keyof typeof defaultVals]
        const currentVal = currentVals[key as keyof typeof currentVals]
        if (JSON.stringify(defaultVal) !== JSON.stringify(currentVal)) {
          console.log(`[MISMATCH] ${key}:`, {
            default: defaultVal,
            current: currentVal,
          })
        }
      })
    }
  }, [form.formState.isDirty, form.formState.dirtyFields, form])

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/p2v`)
  }

  function handleSave() {
    const data = form.getValues()
    const result = pathToVictorySchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    console.log('[PATCH /path-to-victory/:id] Saving:', data)

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  const { isDirty, isValid } = form.formState

  return (
    <>
      {saveSuccess && (
        <Callout.Root color="green" mb="4">
          <Callout.Icon>
            <HiCheck />
          </Callout.Icon>
          <Callout.Text>Changes saved (simulated)</Callout.Text>
        </Callout.Root>
      )}

      <P2VForm
        register={form.register}
        watch={form.watch}
        setValue={form.setValue}
      />

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
  )
}
