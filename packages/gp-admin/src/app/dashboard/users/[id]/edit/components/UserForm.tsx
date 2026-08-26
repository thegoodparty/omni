'use client'

import {
  TextField,
  Text,
  Box,
  Flex,
  Switch,
  Checkbox,
  Separator,
} from '@radix-ui/themes'
import { useState } from 'react'
import { useForm, type FormState, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigationGuard } from 'next-navigation-guard'
import { userSchema, type UserFormData, USER_ROLES } from '../schema'
import { InfoCard } from '../../components/InfoCard'
import { ErrorText } from '@/components/ErrorText'
import { FormActions } from './FormActions'
import { UNSAVED_CHANGES_MESSAGE } from '../constants'
import {
  INPUT_TYPE,
  ROLE_DISPLAY_NAMES,
  USER_FORM_SECTIONS,
  FORM_MODE,
  type InputType,
} from '../constants'
import type { User } from '@goodparty_org/sdk'

type FieldPath = Path<UserFormData>

interface FieldConfig {
  key: FieldPath
  label: string
  placeholder: string
  type?: InputType
  hasError?: boolean
  readOnly?: boolean
}

const BASIC_INFO_FIELDS: FieldConfig[] = [
  {
    key: 'firstName',
    label: 'First Name',
    placeholder: 'First name',
    readOnly: true,
  },
  {
    key: 'lastName',
    label: 'Last Name',
    placeholder: 'Last name',
    readOnly: true,
  },
  {
    key: 'email',
    label: 'Email',
    placeholder: 'email@example.com',
    type: INPUT_TYPE.EMAIL,
    hasError: true,
    readOnly: true,
  },
  { key: 'phone', label: 'Phone', placeholder: 'Phone' },
  { key: 'zip', label: 'ZIP Code', placeholder: 'ZIP' },
]

const USER_SETTINGS_FIELDS: FieldConfig[] = [
  {
    key: 'metaData.hubspotId',
    label: 'HubSpot ID',
    placeholder: 'HubSpot contact ID',
  },
]

interface UserFormProps {
  initialData: User
  onSave: (data: UserFormData) => void | Promise<void>
  onCancel: () => void
}

// Pasted phone numbers often carry non-breaking hyphens (U+2010..U+2015) and
// stray whitespace, which the API's isMobilePhone validation rejects.
const normalizePhone = (value: string) =>
  value.trim().replace(/[\u2010-\u2015\u2212]/g, '-')

const hasDirty = (flag: unknown): boolean =>
  flag === true ||
  (Array.isArray(flag) && flag.some(hasDirty)) ||
  (typeof flag === 'object' &&
    flag !== null &&
    Object.values(flag).some(hasDirty))

// The write schema rejects values legacy rows legitimately hold (empty zip,
// 1-char names) and the email field mirrors the Clerk-enriched read, so
// resubmitting untouched fields can 400 the save or silently rewrite the
// email column. Only send what the admin actually changed.
const pickChangedFields = (
  data: UserFormData,
  dirtyFields: FormState<UserFormData>['dirtyFields']
): UserFormData => {
  const changed: UserFormData = {}
  if (hasDirty(dirtyFields.firstName)) changed.firstName = data.firstName
  if (hasDirty(dirtyFields.lastName)) changed.lastName = data.lastName
  if (hasDirty(dirtyFields.name)) changed.name = data.name
  if (hasDirty(dirtyFields.email)) changed.email = data.email
  if (hasDirty(dirtyFields.phone)) changed.phone = data.phone
  if (hasDirty(dirtyFields.zip)) changed.zip = data.zip
  if (hasDirty(dirtyFields.roles)) changed.roles = data.roles
  const dirtyMetaData = dirtyFields.metaData
  if (dirtyMetaData) {
    const metaData: NonNullable<UserFormData['metaData']> = {}
    if (hasDirty(dirtyMetaData.hubspotId)) {
      metaData.hubspotId = data.metaData?.hubspotId
    }
    if (hasDirty(dirtyMetaData.textNotifications)) {
      metaData.textNotifications = data.metaData?.textNotifications
    }
    if (Object.keys(metaData).length > 0) changed.metaData = metaData
  }
  return changed
}

export function UserForm({ initialData, onSave, onCancel }: UserFormProps) {
  const {
    register,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors, isDirty, isValid, dirtyFields },
  } = useForm<UserFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(userSchema),
    defaultValues: {
      firstName: initialData.firstName ?? '',
      lastName: initialData.lastName ?? '',
      name: initialData.name ?? '',
      email: initialData.email ?? '',
      phone: initialData.phone ?? '',
      zip: initialData.zip ?? '',
      roles: initialData.roles ?? [],
      metaData: {
        hubspotId: initialData.metaData?.hubspotId ?? '',
        textNotifications: initialData.metaData?.textNotifications ?? false,
      },
    },
  })

  const [isSaving, setIsSaving] = useState(false)
  const currentRoles = watch('roles') ?? []

  useNavigationGuard({
    enabled: isDirty,
    confirm: () => window.confirm(UNSAVED_CHANGES_MESSAGE),
  })

  async function handleSubmit() {
    if (isSaving) return
    const data = { ...getValues() }
    if (data.phone !== undefined) {
      data.phone = normalizePhone(data.phone)
    }
    const result = userSchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    setIsSaving(true)
    try {
      await onSave(pickChangedFields(data, dirtyFields))
      reset(data)
    } catch {
      // Save failed — keep the form dirty so the user can retry
    } finally {
      setIsSaving(false)
    }
  }

  function toggleRole(role: (typeof USER_ROLES)[number]) {
    const newRoles = currentRoles.includes(role)
      ? currentRoles.filter((r) => r !== role)
      : [...currentRoles, role]
    setValue('roles', newRoles, { shouldDirty: true })
  }

  function getError(key: FieldPath) {
    if (key === 'email') return errors.email
    return undefined
  }

  function renderFields(fields: FieldConfig[]) {
    return (
      <Flex gap="4" wrap="wrap">
        {fields.map(({ key, label, placeholder, type, hasError, readOnly }) => {
          const error = hasError ? getError(key) : undefined
          return (
            <Box key={key} flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                {label}
              </Text>
              <TextField.Root
                {...{
                  ...register(key),
                  type,
                  placeholder,
                  color: error ? 'red' : undefined,
                  readOnly,
                }}
              />
              {error && <ErrorText>{error.message}</ErrorText>}
            </Box>
          )
        })}
      </Flex>
    )
  }

  return (
    <>
      <Flex direction="column" gap="4">
        <InfoCard title={USER_FORM_SECTIONS.BASIC_INFO}>
          {renderFields(BASIC_INFO_FIELDS)}
        </InfoCard>

        <InfoCard title={USER_FORM_SECTIONS.ROLES}>
          <Flex direction="column" gap="3">
            {USER_ROLES.map((role) => (
              <Flex key={role} align="center" gap="2">
                <Checkbox
                  checked={currentRoles.includes(role)}
                  onCheckedChange={() => toggleRole(role)}
                />
                <Text size="2" style={{ textTransform: 'capitalize' }}>
                  {ROLE_DISPLAY_NAMES[role] ?? role}
                </Text>
              </Flex>
            ))}
          </Flex>
        </InfoCard>

        <InfoCard title={USER_FORM_SECTIONS.USER_SETTINGS}>
          <Flex direction="column" gap="4">
            {renderFields(USER_SETTINGS_FIELDS)}

            <Flex justify="between" align="center">
              <Text as="label" size="2">
                Text Notifications
              </Text>
              <Switch
                checked={watch('metaData.textNotifications') ?? false}
                onCheckedChange={(checked) =>
                  setValue('metaData.textNotifications', checked, {
                    shouldDirty: true,
                  })
                }
              />
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
