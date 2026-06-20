import { useEffect, useRef, useState } from 'react'
import { UploadCloud, X, FileText, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatFileSize } from '@/lib/format'

const isImageFile = (f: File) => f.type.startsWith('image/')

const ACCEPT = '.pdf,.jpg,.jpeg,.png'
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

interface FileDropzoneProps {
  onFile: (f: File | null) => void
  error?: string
}

export default function FileDropzone({ onFile, error }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const thumbRef = useRef<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [thumb, setThumb] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Revoke any outstanding object URL on unmount.
  useEffect(() => {
    return () => {
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current)
    }
  }, [])

  // Swap the image-preview object URL, revoking the previous one.
  const setThumbFor = (f: File | null) => {
    if (thumbRef.current) {
      URL.revokeObjectURL(thumbRef.current)
      thumbRef.current = null
    }
    if (f && isImageFile(f)) {
      const url = URL.createObjectURL(f)
      thumbRef.current = url
      setThumb(url)
    } else {
      setThumb(null)
    }
  }

  const validate = (f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      return 'Only JPEG, PNG, and PDF files are allowed.'
    }
    if (f.size > MAX_FILE_SIZE) {
      return 'File size must be under 5 MB.'
    }
    return null
  }

  const set = (f: File | null) => {
    if (f) {
      const validationError = validate(f)
      if (validationError) {
        setLocalError(validationError)
        setFile(null)
        setThumbFor(null)
        onFile(null)
        if (inputRef.current) inputRef.current.value = ''
        return
      }
    }
    setLocalError(null)
    setFile(f)
    setThumbFor(f)
    onFile(f)
  }

  const remove = (e: React.MouseEvent) => {
    e.stopPropagation()
    setFile(null)
    setThumbFor(null)
    setLocalError(null)
    onFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const displayError = localError ?? error
  const isImage = file ? isImageFile(file) : false
  const MimeIcon = isImage ? ImageIcon : FileText

  return (
    <div className="space-y-1.5">
      {/* The native input stays mounted in both states for Playwright setInputFiles. */}
      <input
        ref={inputRef}
        id="receipt-input"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => set(e.target.files?.[0] ?? null)}
      />

      {file ? (
        // Selected state: compact file chip.
        <div
          className={cn(
            'flex items-center gap-3 rounded-lg border bg-card p-3 shadow-sm',
            displayError && 'border-destructive',
          )}
        >
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
            {isImage && thumb ? (
              <img src={thumb} alt="" className="size-full object-cover" />
            ) : (
              <MimeIcon className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="file-name truncate text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={remove}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Remove file"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        // Empty state: dashed dropzone with the prompt + hint inside.
        <div
          role="button"
          tabIndex={0}
          aria-label="Receipt — drag a file here or click to choose a JPEG, PNG, or PDF up to 5 MB"
          aria-invalid={!!displayError}
          aria-describedby={displayError ? 'receipt-dropzone-error' : undefined}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            set(e.dataTransfer.files?.[0] ?? null)
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-muted/20 p-6 text-center text-sm text-muted-foreground transition-colors hover:border-ring hover:bg-accent/30',
            drag && 'border-primary bg-accent',
            displayError && 'border-destructive',
          )}
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UploadCloud className="size-5 shrink-0" />
          </div>
          <span className="font-medium text-foreground">
            Drag a receipt here, or click to choose
          </span>
          <span className="text-xs">JPEG, PNG, or PDF · up to 5 MB</span>
        </div>
      )}

      {displayError && (
        <p id="receipt-dropzone-error" role="alert" className="field-error text-sm text-destructive">
          {displayError}
        </p>
      )}
    </div>
  )
}
