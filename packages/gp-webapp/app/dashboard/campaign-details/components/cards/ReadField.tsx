import { Button } from '@styleguide'

interface ReadFieldProps {
  label: string
  value?: string | null
  // When true and the value is empty, shows a muted "Add Information"
  // placeholder instead of an em dash.
  placeholder?: boolean
  // Optional inline affordance (e.g. Add / Edit) rendered to the right of the
  // field. Used for fields that own their own edit flow separate from the
  // card's primary action.
  action?: { label: string; onClick: () => void; disabled?: boolean }
}

export default function ReadField({
  label,
  value,
  placeholder = false,
  action,
}: ReadFieldProps): React.JSX.Element {
  const isEmpty = !value
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <p
          className={
            isEmpty
              ? placeholder
                ? 'm-0 text-sm text-muted-foreground/60'
                : 'm-0 text-sm text-muted-foreground'
              : 'm-0 whitespace-pre-line text-sm text-foreground'
          }
        >
          {isEmpty ? (placeholder ? 'Add Information' : '—') : value}
        </p>
      </div>
      {action && (
        <Button
          variant="ghost"
          size="small"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
