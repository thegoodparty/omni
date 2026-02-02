'use client'

import { TextField, Text, Box, Flex, Switch, Checkbox } from '@radix-ui/themes'
import {
  UseFormRegister,
  FieldErrors,
  UseFormWatch,
  UseFormSetValue,
} from 'react-hook-form'
import type { UserFormData } from '../schema'
import { USER_ROLES } from '../schema'
import { InfoCard } from '../../components/InfoCard'
import { ErrorText } from '@/components/ErrorText'

interface UserFormProps {
  register: UseFormRegister<UserFormData>
  errors: FieldErrors<UserFormData>
  watch: UseFormWatch<UserFormData>
  setValue: UseFormSetValue<UserFormData>
}

export function UserForm({ register, errors, watch, setValue }: UserFormProps) {
  const currentRoles = watch('roles') ?? []

  function toggleRole(role: (typeof USER_ROLES)[number]) {
    const newRoles = currentRoles.includes(role)
      ? currentRoles.filter((r) => r !== role)
      : [...currentRoles, role]
    setValue('roles', newRoles)
  }

  return (
    <Flex direction="column" gap="4">
      <InfoCard title="Basic Information">
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                First Name
              </Text>
              <TextField.Root
                {...register('firstName')}
                placeholder="First name"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Last Name
              </Text>
              <TextField.Root
                {...register('lastName')}
                placeholder="Last name"
              />
            </Box>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Display Name
            </Text>
            <TextField.Root {...register('name')} placeholder="Display name" />
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Email
            </Text>
            <TextField.Root
              {...register('email')}
              type="email"
              placeholder="email@example.com"
              color={errors.email ? 'red' : undefined}
            />
            {errors.email && <ErrorText>{errors.email.message}</ErrorText>}
          </Box>

          <Flex gap="4" wrap="wrap">
            <Box flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                Phone
              </Text>
              <TextField.Root {...register('phone')} placeholder="Phone" />
            </Box>
            <Box flexGrow="1" style={{ minWidth: '150px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                ZIP Code
              </Text>
              <TextField.Root {...register('zip')} placeholder="ZIP" />
            </Box>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Avatar URL
            </Text>
            <TextField.Root
              {...register('avatar')}
              placeholder="https://..."
              color={errors.avatar ? 'red' : undefined}
            />
            {errors.avatar && <ErrorText>{errors.avatar.message}</ErrorText>}
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Roles">
        <Flex direction="column" gap="3">
          {USER_ROLES.map((role) => (
            <Flex key={role} align="center" gap="2">
              <Checkbox
                checked={currentRoles.includes(role)}
                onCheckedChange={() => toggleRole(role)}
              />
              <Text size="2" style={{ textTransform: 'capitalize' }}>
                {role === 'campaignManager' ? 'Campaign Manager' : role}
              </Text>
            </Flex>
          ))}
        </Flex>
      </InfoCard>

      <InfoCard title="User Settings">
        <Flex direction="column" gap="4">
          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              HubSpot ID
            </Text>
            <TextField.Root
              {...register('metaData.hubspotId')}
              placeholder="HubSpot contact ID"
            />
          </Box>

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
  )
}
