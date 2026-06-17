import { noop } from '@shared/utils/noop'
import { ImCheckboxChecked, ImCheckboxUnchecked } from 'react-icons/im'

interface Position {
  id: number
  name: string
}

interface IssuePositionProps {
  position: Position
  selected?: boolean
  handleSelectPosition?: (position: Position) => void
  disabled?: boolean
}

export const IssuePosition = ({
  position,
  selected = false,
  handleSelectPosition = noop,
  disabled = false,
}: IssuePositionProps): React.JSX.Element => (
  <div
    className={`
        flex
        items-center
        p-4
        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        rounded-lg
        bg-blue-50
        border-2
        border-grayscale-400
        mb-3
        transition-colors
        ${!disabled ? 'hover:border-brand-halo-green-300' : ''}
        ${selected && !disabled ? 'bg-brand-halo-green-50' : ''}
        ${disabled ? 'text-grayscale-400' : ''}
      `}
    onClick={() => {
      !disabled && handleSelectPosition(position)
    }}
  >
    {selected ? (
      <ImCheckboxChecked className="mr-2" />
    ) : (
      <ImCheckboxUnchecked className="mr-2" />
    )}
    {position.name} {disabled ? '(Previously Selected)' : ''}
  </div>
)
