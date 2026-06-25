import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileDropzone from '@/components/expenses/FileDropzone'

// jsdom implements neither URL.createObjectURL nor URL.revokeObjectURL, yet the
// component calls them to build/tear down the image thumbnail preview. Mock both
// so the object-URL lifecycle (create on image select, revoke on swap/remove/unmount)
// is observable and doesn't throw "Not implemented".
const createObjectURL = jest.fn(() => 'blob:mock-url')
const revokeObjectURL = jest.fn()

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true })
})

beforeEach(() => {
  jest.clearAllMocks()
  // Each call returns a distinct URL so revoke-of-the-previous assertions are precise.
  let n = 0
  createObjectURL.mockImplementation(() => `blob:mock-url-${++n}`)
})

// Build a File with an exact `size` without allocating the bytes: File.size is a
// prototype getter, so an own value property shadows it. Lets us cross the 5 MB cap
// cheaply and pin the MIME type the allowlist checks.
function makeFile(name: string, type: string, size = 1024): File {
  const file = new File(['receipt-bytes'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

// Set files directly on the hidden native input. fireEvent.change bypasses the
// input's `accept` extension filter (which userEvent.upload would apply and which
// would silently drop a disallowed file before validate() ever runs), so the
// component's own type/size guard is what's actually under test.
function selectFile(file: File): HTMLInputElement {
  const input = document.getElementById('receipt-input') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

describe('FileDropzone validate() — type allowlist', () => {
  it('rejects a disallowed file type with the allowlist message and does not surface the file', () => {
    const onFile = jest.fn()
    render(<FileDropzone onFile={onFile} />)

    selectFile(makeFile('notes.txt', 'text/plain'))

    expect(screen.getByRole('alert')).toHaveTextContent('Only JPEG, PNG, and PDF files are allowed.')
    // The rejected file is cleared, not adopted: callback fires with null and no chip renders.
    expect(onFile).toHaveBeenCalledTimes(1)
    expect(onFile).toHaveBeenCalledWith(null)
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
    // Still in the empty dropzone state.
    expect(screen.getByRole('button', { name: /receipt/i })).toBeInTheDocument()
  })

  it.each([
    ['image/jpeg', 'receipt.jpg'],
    ['image/png', 'receipt.png'],
    ['application/pdf', 'receipt.pdf'],
  ])('accepts an allowlisted %s file', (type, name) => {
    const onFile = jest.fn()
    render(<FileDropzone onFile={onFile} />)

    selectFile(makeFile(name, type))

    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name, type }))
    expect(screen.getByText(name)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FileDropzone validate() — 5 MB size cap', () => {
  it('rejects a correctly-typed file that exceeds 5 MB', () => {
    const onFile = jest.fn()
    render(<FileDropzone onFile={onFile} />)

    selectFile(makeFile('huge.png', 'image/png', 5 * 1024 * 1024 + 1))

    expect(screen.getByRole('alert')).toHaveTextContent('File size must be under 5 MB.')
    expect(onFile).toHaveBeenCalledWith(null)
    expect(screen.queryByText('huge.png')).not.toBeInTheDocument()
  })

  it('accepts a file exactly at the 5 MB boundary (not over)', () => {
    const onFile = jest.fn()
    render(<FileDropzone onFile={onFile} />)

    selectFile(makeFile('edge.pdf', 'application/pdf', 5 * 1024 * 1024))

    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'edge.pdf' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('FileDropzone — selected-file chip, remove, and error precedence', () => {
  it('renders the chip with the file name and formatted size on a valid selection', () => {
    render(<FileDropzone onFile={jest.fn()} />)

    selectFile(makeFile('lunch.pdf', 'application/pdf', 2048))

    expect(screen.getByText('lunch.pdf')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument() // formatFileSize(2048)
    expect(screen.getByRole('button', { name: /remove file/i })).toBeInTheDocument()
  })

  it('the remove button clears the selection and returns to the empty dropzone', async () => {
    const user = userEvent.setup()
    const onFile = jest.fn()
    render(<FileDropzone onFile={onFile} />)

    selectFile(makeFile('lunch.pdf', 'application/pdf'))
    onFile.mockClear()

    await user.click(screen.getByRole('button', { name: /remove file/i }))

    expect(onFile).toHaveBeenCalledWith(null)
    expect(screen.queryByText('lunch.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /receipt/i })).toBeInTheDocument()
  })

  it('a fresh validation error overrides the parent-supplied error prop', () => {
    render(<FileDropzone onFile={jest.fn()} error="Receipt is required." />)
    // Parent error shows while empty.
    expect(screen.getByRole('alert')).toHaveTextContent('Receipt is required.')

    selectFile(makeFile('notes.txt', 'text/plain'))
    // localError now takes precedence over the prop (displayError = localError ?? error).
    expect(screen.getByRole('alert')).toHaveTextContent('Only JPEG, PNG, and PDF files are allowed.')
  })

  it('clears a prior local error once a valid file is selected', () => {
    render(<FileDropzone onFile={jest.fn()} />)

    selectFile(makeFile('notes.txt', 'text/plain'))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    selectFile(makeFile('ok.png', 'image/png'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('ok.png')).toBeInTheDocument()
  })
})

describe('FileDropzone — object-URL thumbnail lifecycle', () => {
  it('creates an object URL and renders an <img> preview for an image file', () => {
    const { container } = render(<FileDropzone onFile={jest.fn()} />)

    selectFile(makeFile('photo.jpg', 'image/jpeg'))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const img = container.querySelector('img') // chip preview, alt=""
    expect(img).toHaveAttribute('src', 'blob:mock-url-1')
  })

  it('does NOT create an object URL for a non-image (PDF) file', () => {
    const { container } = render(<FileDropzone onFile={jest.fn()} />)

    selectFile(makeFile('doc.pdf', 'application/pdf'))

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('revokes the outstanding object URL when the image is removed', async () => {
    const user = userEvent.setup()
    render(<FileDropzone onFile={jest.fn()} />)

    selectFile(makeFile('photo.jpg', 'image/jpeg'))
    expect(createObjectURL).toHaveReturnedWith('blob:mock-url-1')

    await user.click(screen.getByRole('button', { name: /remove file/i }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-1')
  })

  it('revokes the previous object URL when a new image replaces an old one', () => {
    render(<FileDropzone onFile={jest.fn()} />)

    selectFile(makeFile('first.jpg', 'image/jpeg'))
    selectFile(makeFile('second.png', 'image/png'))

    // The first URL is revoked before the second is shown.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-1')
    expect(createObjectURL).toHaveBeenCalledTimes(2)
  })

  it('revokes the outstanding object URL on unmount', () => {
    const { unmount } = render(<FileDropzone onFile={jest.fn()} />)
    selectFile(makeFile('photo.jpg', 'image/jpeg'))

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url-1')
  })
})

describe('FileDropzone — drag-and-drop and keyboard activation', () => {
  it('selects a valid file dropped onto the zone (runs the same validate path)', () => {
    const onFile = jest.fn()
    render(<FileDropzone onFile={onFile} />)
    const dropzone = screen.getByRole('button', { name: /receipt/i })

    const file = makeFile('dropped.png', 'image/png')
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'dropped.png' }))
    expect(screen.getByText('dropped.png')).toBeInTheDocument()
  })

  it('rejects a disallowed dropped file via the same guard', () => {
    const onFile = jest.fn()
    render(<FileDropzone onFile={onFile} />)
    const dropzone = screen.getByRole('button', { name: /receipt/i })

    fireEvent.drop(dropzone, { dataTransfer: { files: [makeFile('bad.txt', 'text/plain')] } })

    expect(screen.getByRole('alert')).toHaveTextContent('Only JPEG, PNG, and PDF files are allowed.')
    expect(onFile).toHaveBeenCalledWith(null)
  })

  it('toggles the drag-active styling on dragOver / dragLeave', () => {
    render(<FileDropzone onFile={jest.fn()} />)
    const dropzone = screen.getByRole('button', { name: /receipt/i })

    // 'border-primary' is applied only in the drag-active state (the base class
    // already carries hover:bg-accent/30, so 'bg-accent' alone wouldn't discriminate).
    fireEvent.dragOver(dropzone)
    expect(dropzone.className).toContain('border-primary')

    fireEvent.dragLeave(dropzone)
    expect(dropzone.className).not.toContain('border-primary')
  })

  it.each(['Enter', ' '])('opens the native file picker on "%s" key', (key) => {
    render(<FileDropzone onFile={jest.fn()} />)
    const input = document.getElementById('receipt-input') as HTMLInputElement
    const clickSpy = jest.spyOn(input, 'click').mockImplementation(() => {})
    const dropzone = screen.getByRole('button', { name: /receipt/i })

    fireEvent.keyDown(dropzone, { key })

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('proxies a click on the empty zone to the hidden input', () => {
    render(<FileDropzone onFile={jest.fn()} />)
    const input = document.getElementById('receipt-input') as HTMLInputElement
    const clickSpy = jest.spyOn(input, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: /receipt/i }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
