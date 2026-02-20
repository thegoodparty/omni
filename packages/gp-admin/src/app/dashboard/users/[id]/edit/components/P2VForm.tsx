'use client'

import {
  TextField,
  Text,
  Box,
  Flex,
  Select,
  Switch,
  Separator,
} from '@radix-ui/themes'
import { useForm, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { pathToVictorySchema, type PathToVictoryFormData } from '../schema'
import { P2V_STATUS, P2V_STATUS_SET } from '../../constants'
import { type P2VStatus, type PathToVictory } from '@goodparty_org/sdk'
import { useNavigationGuard } from 'next-navigation-guard'
import { InfoCard } from '../../components/InfoCard'
import { FormActions } from './FormActions'
import {
  INPUT_TYPE,
  P2V_FORM_SECTIONS,
  FORM_MODE,
  SELECT_NONE_VALUE,
  UNSAVED_CHANGES_MESSAGE,
  type InputType,
} from '../constants'

type FieldPath = Path<PathToVictoryFormData>

interface FieldConfig {
  key: FieldPath
  label: string
  placeholder: string
  type?: InputType
  step?: string
  minWidth?: string
}

const numberFieldOptions = {
  setValueAs: (v: string) => {
    if (v === '' || v === null || v === undefined) return undefined
    const num = Number(v)
    return isNaN(num) ? undefined : num
  },
}

const ELECTION_INFO_FIELDS: FieldConfig[] = [
  {
    key: 'electionType',
    label: 'Election Type',
    placeholder: 'e.g., General, Primary',
    minWidth: '200px',
  },
  {
    key: 'electionLocation',
    label: 'Election Location',
    placeholder: 'Location',
    minWidth: '200px',
  },
]

const TARGET_NUMBER_FIELDS: FieldConfig[] = [
  {
    key: 'winNumber',
    label: 'Win Number',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
  },
  {
    key: 'voterContactGoal',
    label: 'Voter Contact Goal',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
  },
  {
    key: 'totalRegisteredVoters',
    label: 'Total Registered Voters',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
  },
  {
    key: 'projectedTurnout',
    label: 'Projected Turnout',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
  },
  {
    key: 'averageTurnout',
    label: 'Average Turnout',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
  },
]

const PARTY_FIELDS: FieldConfig[] = [
  {
    key: 'republicans',
    label: 'Republicans',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'democrats',
    label: 'Democrats',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'indies',
    label: 'Independents',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
]

const GENDER_FIELDS: FieldConfig[] = [
  { key: 'men', label: 'Men', placeholder: '0', type: INPUT_TYPE.NUMBER },
  { key: 'women', label: 'Women', placeholder: '0', type: INPUT_TYPE.NUMBER },
]

const RACE_FIELDS: FieldConfig[] = [
  {
    key: 'white',
    label: 'White',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'asian',
    label: 'Asian',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'africanAmerican',
    label: 'African American',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'hispanic',
    label: 'Hispanic',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
]

const VIABILITY_FIELDS: FieldConfig[] = [
  { key: 'viability.level', label: 'Level', placeholder: 'Level' },
  {
    key: 'viability.seats',
    label: 'Seats',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '100px',
  },
  {
    key: 'viability.candidates',
    label: 'Candidates',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '100px',
  },
  {
    key: 'viability.candidatesPerSeat',
    label: 'Candidates/Seat',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    step: '0.01',
    minWidth: '120px',
  },
  {
    key: 'viability.score',
    label: 'Score',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    step: '0.01',
    minWidth: '100px',
  },
  {
    key: 'viability.probOfWin',
    label: 'Prob. of Win',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    step: '0.01',
    minWidth: '120px',
  },
]

type ViabilityBooleanField = 'isPartisan' | 'isIncumbent' | 'isUncontested'

const VIABILITY_BOOLEAN_FIELDS: {
  key: ViabilityBooleanField
  label: string
}[] = [
  { key: 'isPartisan', label: 'Partisan' },
  { key: 'isIncumbent', label: 'Incumbent' },
  { key: 'isUncontested', label: 'Uncontested' },
]

function isP2VStatus(value: string): value is P2VStatus {
  return P2V_STATUS_SET.has(value)
}

interface P2VFormProps {
  initialData: PathToVictory | null
  onSave: (data: PathToVictoryFormData) => void | Promise<void>
  onCancel: () => void
  isSaving?: boolean
}

export function P2VForm({
  initialData,
  onSave,
  onCancel,
  isSaving,
}: P2VFormProps) {
  const p2v = initialData

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

  function handleStatusChange(value: string) {
    if (isP2VStatus(value)) {
      setValue('p2vStatus', value, { shouldDirty: true })
    } else {
      setValue('p2vStatus', undefined, { shouldDirty: true })
    }
  }

  function handleViabilityBooleanChange(
    field: ViabilityBooleanField,
    checked: boolean
  ) {
    setValue(`viability.${field}`, checked, { shouldDirty: true })
  }

  function renderFields(fields: FieldConfig[]) {
    return (
      <Flex gap="4" wrap="wrap">
        {fields.map(
          ({ key, label, placeholder, type, step, minWidth = '150px' }) => (
            <Box key={key} flexGrow="1" style={{ minWidth }}>
              <Text as="label" size="2" weight="medium" mb="1">
                {label}
              </Text>
              <TextField.Root
                {...register(
                  key,
                  type === INPUT_TYPE.NUMBER ? numberFieldOptions : undefined
                )}
                type={type}
                placeholder={placeholder}
                step={step}
              />
            </Box>
          )
        )}
      </Flex>
    )
  }

  return (
    <>
      <Flex direction="column" gap="4">
        <InfoCard title={P2V_FORM_SECTIONS.STATUS}>
          <Flex direction="column" gap="4">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium">
                Status
              </Text>
              <Select.Root
                value={watch('p2vStatus') ?? SELECT_NONE_VALUE}
                onValueChange={handleStatusChange}
              >
                <Select.Trigger placeholder="Select status..." />
                <Select.Content>
                  <Select.Item value={SELECT_NONE_VALUE}>None</Select.Item>
                  {P2V_STATUS.map((status) => (
                    <Select.Item key={status} value={status}>
                      {status}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            {renderFields(ELECTION_INFO_FIELDS)}
          </Flex>
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.TARGET_NUMBERS}>
          {renderFields(TARGET_NUMBER_FIELDS)}
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.PARTY_DEMOGRAPHICS}>
          {renderFields(PARTY_FIELDS)}
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.GENDER_DEMOGRAPHICS}>
          {renderFields(GENDER_FIELDS)}
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.RACE_DEMOGRAPHICS}>
          {renderFields(RACE_FIELDS)}
        </InfoCard>

        <InfoCard title={P2V_FORM_SECTIONS.VIABILITY}>
          <Flex direction="column" gap="4">
            {renderFields(VIABILITY_FIELDS)}

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
