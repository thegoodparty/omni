interface ReadFieldProps {
  label: string
  value?: string | null
  // When true and the value is empty, shows a muted "Add Information"
  // placeholder instead of an em dash.
  placeholder?: boolean
}

export default function ReadField({
  label,
  value,
  placeholder = false,
}: ReadFieldProps): React.JSX.Element {
  const isEmpty = !value
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
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
  )
}
