import type { ReactElement } from 'react'
import type { LayoutProps } from '../emailTemplate.types'
import {
  EmailBodyBlock,
  EmailColumnImage,
  EmailFilledButton,
  EmailFooter,
  EmailLetterHeadline,
  EmailParagraph,
  EmailSignature,
  LETTER_GUTTER,
} from '../components'

const PART_GAP = 32

// The fixed letter: the schema already holds the blocks to photo, headline,
// text, photo, text, button, signature, so this draws them in order. The
// container alone spaces the parts; no part carries an outer margin. The
// template color tints only the button and the profile link.
export const PhotoLetterLayout = ({ colors, blocks, context }: LayoutProps) => {
  const parts = blocks.flatMap((block): ReactElement[] => {
    switch (block.type) {
      case 'image':
        return [
          <EmailColumnImage key="image" url={block.url} alt={block.alt} />,
        ]
      case 'heading':
        return [
          <EmailLetterHeadline
            key="heading"
            colors={colors}
            text={block.text}
          />,
        ]
      case 'paragraph':
        return [
          <EmailParagraph
            key="paragraph"
            colors={colors}
            text={block.text}
            flush
          />,
        ]
      case 'button':
        return [
          <EmailFilledButton
            key="button"
            colors={colors}
            label={block.label}
            url={block.url}
          />,
        ]
      case 'signature':
        return [
          <EmailSignature
            key="signature"
            colors={colors}
            name={block.name}
            office={block.office}
            imageUrl={block.imageUrl}
            profileUrl={block.profileUrl}
          />,
        ]
      case 'divider':
        return []
    }
  })
  return (
    <>
      <EmailBodyBlock
        colors={colors}
        padding={`${LETTER_GUTTER}px ${LETTER_GUTTER}px`}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          style={{ width: '100%' }}
        >
          <tbody>
            {parts.map((part, index) => (
              <tr key={index}>
                <td style={{ paddingTop: index === 0 ? 0 : PART_GAP }}>
                  {part}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EmailBodyBlock>
      <EmailFooter colors={colors} context={context} />
    </>
  )
}
