'use client'

import { Flex, Button } from '@radix-ui/themes'
import { HiCheck, HiX } from 'react-icons/hi'

interface FormActionsProps {
  onCancel: () => void
  onSubmit: () => void
  isValid: boolean
  isDirty: boolean
}

export function FormActions({
  onCancel,
  onSubmit,
  isValid,
  isDirty,
}: FormActionsProps) {
  return (
    <Flex gap="3" justify="end">
      <Button type="button" variant="soft" color="gray" onClick={onCancel}>
        <HiX className="w-4 h-4" />
        Cancel
      </Button>
      <Button type="button" onClick={onSubmit} disabled={!isValid || !isDirty}>
        <HiCheck className="w-4 h-4" />
        Save Changes
      </Button>
    </Flex>
  )
}
