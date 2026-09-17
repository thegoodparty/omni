import TextField from '@shared/inputs/TextField'
import ImageInput from '@shared/inputs/ImageInput'
import Caption from './WebsiteEditorPageCaption'
import Label from './Label'
import H2 from '@shared/typography/H2'
import { ChangeEvent } from 'react'

interface HeroStepProps {
  tagline?: string
  image?: string
  onTaglineChange: (value: string) => void
  onImageChange: (file: File | null) => void
  noHeading?: boolean
}

export default function HeroStep({
  tagline,
  image,
  onTaglineChange,
  onImageChange,
  noHeading = false,
}: HeroStepProps): React.JSX.Element {
  return (
    <div>
      {!noHeading && (
        <H2 className="mb-6">Customize the content visitors will see first</H2>
      )}
      <Label>Tagline</Label>
      <TextField
        value={tagline}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          onTaglineChange(e.target.value)
        }
        fullWidth
      />
      <Label className="mt-4">Main Image</Label>
      <ImageInput
        imageUrl={image}
        onChange={onImageChange}
        maxSize={0.5 * 1024 * 1024}
      />
      <Caption>
        Recommended size: 1280x640px. PNG or JPG format. File size must be less
        than 512KB.
      </Caption>
    </div>
  )
}
