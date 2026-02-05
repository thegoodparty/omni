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
import { useForm, type Path } from 'react-hook-form'
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
import type { User } from '../../types/user'

type FieldPath = Path<UserFormData>

interface FieldConfig {
  key: FieldPath
  label: string
  placeholder: string
  type?: InputType
  hasError?: boolean
}

const BASIC_INFO_FIELDS: FieldConfig[] = [
  { key: 'firstName', label: 'First Name', placeholder: 'First name' },
  { key: 'lastName', label: 'Last Name', placeholder: 'Last name' },
  { key: 'name', label: 'Display Name', placeholder: 'Display name' },
  {
    key: 'email',
    label: 'Email',
    placeholder: 'email@example.com',
    type: INPUT_TYPE.EMAIL,
    hasError: true,
  },
  { key: 'phone', label: 'Phone', placeholder: 'Phone' },
  { key: 'zip', label: 'ZIP Code', placeholder: 'ZIP' },
  {
    key: 'avatar',
    label: 'Avatar URL',
    placeholder: 'https://...',
    hasError: true,
  },
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
  onSave: (data: UserFormData) => void
  onCancel: () => void
}

export function UserForm({ initialData, onSave, onCancel }: UserFormProps) {
  const {
    register,
    watch,
    setValue,
    getValues,
    formState: { errors, isDirty, isValid },
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
      avatar: initialData.avatar ?? '',
      roles: initialData.roles ?? [],
      metaData: {
        hubspotId: initialData.metaData?.hubspotId ?? '',
        textNotifications: initialData.metaData?.textNotifications ?? false,
      },
    },
  })

  const currentRoles = watch('roles') ?? []

  useNavigationGuard({
    enabled: isDirty,
    confirm: () => window.confirm(UNSAVED_CHANGES_MESSAGE),
  })

  function handleSubmit() {
    const data = getValues()
    const result = userSchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    onSave(data)
  }

  function toggleRole(role: (typeof USER_ROLES)[number]) {
    const newRoles = currentRoles.includes(role)
      ? currentRoles.filter((r) => r !== role)
      : [...currentRoles, role]
    setValue('roles', newRoles)
  }

  function getError(key: FieldPath) {
    if (key === 'email') return errors.email
    if (key === 'avatar') return errors.avatar
    return undefined
  }

  function renderFields(fields: FieldConfig[]) {
    return (
      <Flex gap="4" wrap="wrap">
        {fields.map(({ key, label, placeholder, type, hasError }) => {
          const error = hasError ? getError(key) : undefined
          return (
            <Box key={key} flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                {label}
              </Text>
              <TextField.Root
                {...register(key)}
                type={type}
                placeholder={placeholder}
                color={error ? 'red' : undefined}
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
                  setValue('metaData.textNotifications', checked)
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
      />
    </>
  )
}
