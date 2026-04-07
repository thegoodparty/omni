'use client'

import { TextField, Text, Box, Flex } from '@radix-ui/themes'
import { type UseFormRegister } from 'react-hook-form'
import { type PathToVictoryFormData } from '../schema'
import { INPUT_TYPE } from '../constants'
import { type FieldConfig, numberFieldOptions } from './fieldConfigs'

interface P2VFieldGroupProps {
  fields: FieldConfig[]
  register: UseFormRegister<PathToVictoryFormData>
}

export function P2VFieldGroup({ fields, register }: P2VFieldGroupProps) {
  return (
    <Flex gap="4" wrap="wrap">
      {fields.map(
        ({
          key,
          label,
          placeholder,
          type,
          step,
          minWidth = '150px',
          formula,
        }) => (
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
              readOnly={formula}
              style={
                formula ? { opacity: 0.6, cursor: 'not-allowed' } : undefined
              }
            />
          </Box>
        )
      )}
    </Flex>
  )
}
