'use client'

import FormControlLabel from '@mui/material/FormControlLabel'
import MuiCheckbox, {
  CheckboxProps as MuiCheckboxProps,
} from '@mui/material/Checkbox'

interface CheckboxProps extends MuiCheckboxProps {
  label?: string
  name?: string
  theme?: {
    muiColor?: string
  }
}

const Checkbox = ({ label, name, theme, ...restProps }: CheckboxProps) => {
  const sx = theme?.muiColor ? {
    color: theme.muiColor,
    '&.Mui-checked': {
      color: theme.muiColor,
    },
    '& .MuiSvgIcon-root': {
      fill: theme.muiColor,
    },
    '&.Mui-checked .MuiSvgIcon-root': {
      fill: theme.muiColor,
    },
  } : undefined

  return label ? (
    <FormControlLabel
      label={label}
      control={<MuiCheckbox name={name} sx={sx} {...restProps} />}
    />
  ) : (
    <MuiCheckbox name={name} sx={sx} {...restProps} />
  )
}

export default Checkbox
