import type { LayoutProps } from '../emailTemplate.types'
import {
  EmailBodyBlock,
  EmailFooter,
  EmailInsetImage,
  EmailParagraph,
  EmailTextLink,
} from '../components'

// Reads like a plain email: no header or banner, the button as a text link,
// and the photo padded and centered. The link is the only theme color.
export const PersonalLetterLayout = ({
  colors,
  blocks,
  context,
}: LayoutProps) => (
  <>
    <EmailBodyBlock colors={colors} padding="32px 32px 16px">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return (
              <EmailParagraph key={index} colors={colors} text={block.text} />
            )
          case 'image':
            return (
              <EmailInsetImage key={index} url={block.url} alt={block.alt} />
            )
          case 'button':
            return (
              <EmailTextLink
                key={index}
                colors={colors}
                label={block.label}
                url={block.url}
              />
            )
          case 'heading':
          case 'divider':
            return null
        }
      })}
    </EmailBodyBlock>
    <EmailFooter colors={colors} context={context} />
  </>
)
