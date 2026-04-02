'use client'

import { Flex, Switch, Text, Separator } from '@radix-ui/themes'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { pathToVictorySchema, type PathToVictoryFormData } from '../schema'
import { type PathToVictory } from '@goodparty_org/sdk'
import { useNavigationGuard } from 'next-navigation-guard'
import { InfoCard } from '../../components/InfoCard'
import { FormActions } from './FormActions'
import {
  P2V_FORM_SECTIONS,
  FORM_MODE,
  UNSAVED_CHANGES_MESSAGE,
} from '../constants'
import { P2VFieldGroup } from './P2VFieldGroup'
import { P2VStatusSection } from './P2VStatusSection'
import {
  TARGET_NUMBER_FIELDS,
  PARTY_FIELDS,
  GENDER_FIELDS,
  RACE_FIELDS,
  VIABILITY_FIELDS,
  VIABILITY_BOOLEAN_FIELDS,
  type ViabilityBooleanField,
} from './fieldConfigs'

interface P2VFormProps {
  initialData: PathToVictory | null
  onSave: (data: PathToVictoryFormData) => void | Promise<void>
  onCancel: () => void
  isSaving?: boolean
  district?: {
    state: string
    electionYear: number
    campaignId: number
    userId: number
    onDistrictSaved?: () => void
  }
}

export function P2VForm({
  initialData,
  onSave,
  onCancel,
  isSaving,
  district,
}: P2VFormProps) {
  const p2v = initialData
  const didInit = useRef(false)

  const {
    register,
    watch,
    setValue,
    getValues,
    reset,
    formState: { isDirty, isValid },
  } = useForm<PathToVictoryFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(pathToVictorySchema),
    defaultValues: {
      p2vStatus: p2v?.data?.p2vStatus,
      electionType: p2v?.data?.electionType ?? '',
      electionLocation: p2v?.data?.electionLocation ?? '',
      winNumber: p2v?.data?.winNumber ?? undefined,
      voterContactGoal: p2v?.data?.voterContactGoal ?? undefined,
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
        isIncumbent: p2v?.data?.viability?.isIncumbent ?? false,
        isUncontested: p2v?.data?.viability?.isUncontested ?? false,
        candidates: p2v?.data?.viability?.candidates ?? undefined,
        seats: p2v?.data?.viability?.seats ?? undefined,
        candidatesPerSeat: p2v?.data?.viability?.candidatesPerSeat ?? undefined,
        score: p2v?.data?.viability?.score ?? undefined,
        probOfWin: p2v?.data?.viability?.probOfWin ?? undefined,
      },
    },
  })

  useNavigationGuard({
    enabled: isDirty,
    confirm: () => window.confirm(UNSAVED_CHANGES_MESSAGE),
  })

  const projectedTurnout = watch('projectedTurnout')

  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true
      return
    }
    const pt = projectedTurnout
    setValue(
      'winNumber',
      pt != null && pt > 0 ? Math.floor(pt * 0.5) + 1 : undefined,
      { shouldDirty: true }
    )
    setValue(
      'voterContactGoal',
      pt != null && pt > 0 ? Math.floor(pt * 5) : undefined,
      { shouldDirty: true }
    )
  }, [projectedTurnout, setValue])

  async function handleSubmit() {
    const data = getValues()
    const result = pathToVictorySchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    try {
      await onSave(data)
      reset(data)
    } catch {
      // Save failed — keep the form dirty so the user can retry
    }
  }

  function handleViabilityBooleanChange(
    field: ViabilityBooleanField,
    checked: boolean
  ) {
    setValue(`viability.${field}`, checked, { shouldDirty: true })
  }

  return (
    <>
      <Flex direction="column" gap="4">
        <InfoCard title={P2V_FORM_SECTIONS.STATUS}>
          <P2VStatusSection
            watch={watch}
            setValue={setValue}
            district={
              district && {
                ...district,
                initialElectionType: p2v?.data?.electionType,
                initialElectionLocation: p2v?.data?.electionLocation,
              }
            }
          />
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.TARGET_NUMBERS}>
          <P2VFieldGroup fields={TARGET_NUMBER_FIELDS} register={register} />
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.PARTY_DEMOGRAPHICS}>
          <P2VFieldGroup fields={PARTY_FIELDS} register={register} />
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.GENDER_DEMOGRAPHICS}>
          <P2VFieldGroup fields={GENDER_FIELDS} register={register} />
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.RACE_DEMOGRAPHICS}>
          <P2VFieldGroup fields={RACE_FIELDS} register={register} />
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.VIABILITY}>
          <Flex direction="column" gap="4">
            <P2VFieldGroup fields={VIABILITY_FIELDS} register={register} />
            <Flex gap="4" wrap="wrap">
              {VIABILITY_BOOLEAN_FIELDS.map(({ key, label }) => (
                <Flex
                  key={key}
                  align="center"
                  gap="2"
                  style={{ minWidth: '120px' }}
                >
                  <Switch
                    checked={watch(`viability.${key}`) ?? false}
                    onCheckedChange={(checked) =>
                      handleViabilityBooleanChange(key, checked)
                    }
                  />
                  <Text size="2">{label}</Text>
                </Flex>
              ))}
            </Flex>
          </Flex>
        </InfoCard>
      </Flex>

      <Separator size="4" my="6" />

      <FormActions
        onCancel={onCancel}
        onSubmit={handleSubmit}
        isValid={isValid}
        isDirty={isDirty}
        isSaving={isSaving}
      />
    </>
  )
}
