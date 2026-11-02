import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { PollImageDropzone } from './PollImageDropzone'
import { SERVE_POLL_QUESTION_COPY } from './pollCopy'

const uploadFileToS3 = vi.fn(async (_file: File) => 'https://cdn.test/poll.png')
vi.mock('@shared/utils/s3Upload', () => ({
  uploadFileToS3: (file: File) => uploadFileToS3(file),
}))
vi.mock('browser-image-compression', () => ({
  default: async (file: File) => file,
}))

const fileInput = () =>
  document.querySelector<HTMLInputElement>('input[type="file"]')!

describe('PollImageDropzone', () => {
  it('uploads a PNG and hands back its URL', async () => {
    const onImageChange = vi.fn()
    render(
      <PollImageDropzone imageUrl={undefined} onImageChange={onImageChange} />,
    )

    fireEvent.change(fileInput(), {
      target: { files: [new File(['x'], 'poll.png', { type: 'image/png' })] },
    })

    await waitFor(() =>
      expect(onImageChange).toHaveBeenCalledWith('https://cdn.test/poll.png'),
    )
  })

  it('refuses a file that is not a PNG or JPG', async () => {
    const onImageChange = vi.fn()
    render(
      <PollImageDropzone imageUrl={undefined} onImageChange={onImageChange} />,
    )

    fireEvent.change(fileInput(), {
      target: { files: [new File(['x'], 'poll.gif', { type: 'image/gif' })] },
    })

    expect(
      await screen.findByText(SERVE_POLL_QUESTION_COPY.imageTypeError),
    ).toBeInTheDocument()
    expect(onImageChange).not.toHaveBeenCalled()
  })

  it('removes the image', async () => {
    const onImageChange = vi.fn()
    render(
      <PollImageDropzone
        imageUrl="https://cdn.test/poll.png"
        onImageChange={onImageChange}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove image' }))

    expect(onImageChange).toHaveBeenCalledWith(undefined)
  })
})
