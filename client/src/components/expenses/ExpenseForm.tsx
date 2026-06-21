import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, Controller, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { AlertCircle, CalendarDays, Loader2 } from 'lucide-react'
import type { Expense } from '../../types'
import { Category, Status } from '../../types'
import {
  useCreateExpense,
  useUpdateExpense,
  useResubmitExpense,
} from '@/queries/expenses'
import { useMe } from '@/queries/me'
import { CATEGORY_OPTIONS, CURRENCY_OPTIONS, isSupportedCurrency } from '@/lib/options'
import { formatCategory } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import FileDropzone from './FileDropzone'

// ---------------------------------------------------------------------------
// Zod schema — rules are frozen; e2e checks label words in error messages
// ---------------------------------------------------------------------------
const expenseFormSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or fewer'),
  description: z
    .string()
    .max(5000, 'Description must be 5000 characters or fewer')
    .optional()
    .or(z.literal('')),
  amount: z
    .coerce.number({ error: 'Amount must be a number' })
    .min(0.01, 'Amount must be greater than 0')
    .max(99_999_999.99, 'Amount must be at most 99,999,999.99')
    // Mirror the server's cents round-trip so >2-decimal amounts fail here with a
    // clear field error instead of an opaque 400 toast. (server expenseSchema.ts)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
      'Amount must have at most 2 decimal places',
    ),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Currency must be a 3-letter code')
    .transform((v) => v.toUpperCase())
    // The UI only offers CURRENCY_OPTIONS; enforce that whitelist here too so a
    // stray code (e.g. from a tampered request or legacy data) can't round-trip.
    .refine(isSupportedCurrency, 'Select a supported currency'),
  category: z.enum(
    Object.values(Category) as [string, ...string[]],
    { error: 'Please select a category' },
  ),
  // Mirror the server: a real YYYY-MM-DD that is not in the future and not more
  // than 5 years old. Without these the client passed validation and the user
  // got a generic failure toast that hid the real (server) reason.
  expense_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required')
    .refine((v) => new Date(`${v}T00:00:00Z`).getTime() <= todayUtcMs(), 'Expense date cannot be in the future')
    .refine(
      (v) => new Date(`${v}T00:00:00Z`).getTime() >= minExpenseDateUtcMs(),
      'Expense date cannot be more than 5 years in the past',
    ),
})

// UTC midnight today, matching the server's future-date comparison.
function todayUtcMs(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

// UTC midnight five years ago, matching the server's past-date floor.
function minExpenseDateUtcMs(): number {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - 5)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

type ExpenseFormData = z.infer<typeof expenseFormSchema>

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ExpenseFormProps {
  mode?: 'create' | 'edit'
  initial?: Expense
  expenseId?: number
}

// Shared styling for the native <select>/<input type="date"> so they read like
// the ui Input. (These two MUST stay native for Playwright selectOption/fill.)
const nativeFieldCls = cn(
  'h-9 w-full min-w-0 rounded-md border border-input bg-muted/40 px-3 py-1',
  'text-base shadow-xs transition-[color,box-shadow] outline-none dark:bg-input/30',
  'placeholder:text-muted-foreground',
  'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  'md:text-sm',
)

const RequiredMark = () => (
  <span className="text-destructive" aria-hidden>
    *
  </span>
)

const FieldError = ({ message }: { message?: string }) =>
  message ? (
    <p className="field-error flex items-center gap-1.5 text-sm text-destructive">
      <AlertCircle className="size-3.5 shrink-0" />
      {message}
    </p>
  ) : null

// Section wrapper for grouped fields.
const Section = ({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) => (
  <section className="space-y-4">
    <div className="space-y-0.5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
    {children}
  </section>
)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ExpenseForm({
  mode = 'create',
  initial,
  expenseId,
}: ExpenseFormProps) {
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)

  const createExpense = useCreateExpense()
  const updateExpense = useUpdateExpense()
  const resubmitExpense = useResubmitExpense()

  // Editing a REJECTED expense resubmits it for approval (status → PENDING)
  // rather than a plain in-place update.
  const isResubmit = mode === 'edit' && initial?.status === Status.REJECTED

  // Native date-input bounds mirror the schema: no future dates, max 5 years back.
  const toYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const maxExpenseDate = toYmd(new Date())
  const minExpenseDate = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 5)
    return toYmd(d)
  })()

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseFormSchema) as Resolver<ExpenseFormData>,
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      amount: initial?.amount ?? undefined,
      currency: initial?.currency ?? 'USD',
      category: initial?.category ?? Category.OTHER,
      // Backend may return expense_date as a full ISO datetime; the native date
      // input requires a bare YYYY-MM-DD, so normalise to the first 10 chars.
      expense_date: initial?.expense_date ? initial.expense_date.slice(0, 10) : '',
    } as Partial<ExpenseFormData>,
  })

  // On a fresh expense, pre-fill the currency from the user's saved default.
  // The cached `/me` profile carries the preference; only fetch in create mode.
  const { data: me } = useMe({ enabled: mode === 'create' })

  // Best-effort: only applies while the field is still at the 'USD' fallback, so
  // it never clobbers a currency the user already picked, and failures are silent.
  // Only apply a supported currency — otherwise the Select (which lists only
  // CURRENCY_OPTIONS) would render blank while the form value diverged.
  useEffect(() => {
    if (mode !== 'create') return
    const pref = me?.default_currency
    if (pref && isSupportedCurrency(pref) && getValues('currency') === 'USD') {
      setValue('currency', pref.toUpperCase())
    }
  }, [mode, me, getValues, setValue])

  const isEdit = mode === 'edit'

  // Submitting is in flight whenever any of the relevant mutations is pending.
  const isSubmitting = isResubmit
    ? resubmitExpense.isPending
    : isEdit
      ? updateExpense.isPending
      : createExpense.isPending

  // -------------------------------------------------------------------------
  // Mutation error handling — shared across create/edit/resubmit.
  // -------------------------------------------------------------------------
  // A failed write may surface a 409 (edit/resubmit only) or a field-level
  // validation message. axios errors carry the server envelope on `response`.
  const handleSubmitError = (err: unknown) => {
    const axiosErr = err as {
      response?: { status?: number; data?: { error?: { message?: string } } }
    }
    if (isEdit && axiosErr?.response?.status === 409) {
      toast.error('This expense changed since you opened it — please reload.')
      return
    }
    // Surface the server's specific reason (e.g. a field-level validation
    // message) instead of a generic string that hid why the submit failed.
    const serverMessage = axiosErr?.response?.data?.error?.message
    setSubmitError(
      serverMessage ?? 'Failed to submit expense. Please check your inputs and try again.',
    )
    toast.error(serverMessage ?? 'Failed to submit expense.')
  }

  // -------------------------------------------------------------------------
  // Submit handler
  // -------------------------------------------------------------------------
  const onSubmit = (values: ExpenseFormData) => {
    setSubmitError('')
    if (mode === 'create') {
      const data = new FormData()
      data.append('title', values.title)
      if (values.description) data.append('description', values.description)
      data.append('amount', String(values.amount))
      data.append('currency', values.currency)
      data.append('category', values.category)
      data.append('expense_date', values.expense_date)
      if (receipt) data.append('receipt', receipt)
      // NOTE: do NOT set Content-Type — axios derives the multipart boundary
      createExpense.mutate(data, {
        onSuccess: () => navigate('/'),
        onError: handleSubmitError,
      })
      return
    }

    // Edit mode: plain JSON body, no receipt re-upload. A rejected expense
    // is resubmitted (back to PENDING); a pending one is updated in place.
    // expenseId is always present in edit mode (EditExpense validates it).
    const id = expenseId as number

    // Normalize an empty/whitespace description to null so it round-trips
    // consistently — the server stores '' as '', silently turning a
    // previously-null description into an empty string on every edit. Apply the
    // same rule to `initial` when diffing below so a legacy stored '' doesn't
    // read as a change against the null we'd send.
    const normalizeDescription = (d: string | null | undefined) =>
      d && d.trim() ? d : null
    const description = normalizeDescription(values.description)

    if (isResubmit) {
      // Resubmit re-files the (rejected) expense with its current values; the
      // server allows an unchanged body here, so send the full set.
      resubmitExpense.mutate(
        {
          id,
          body: {
            title: values.title,
            amount: values.amount,
            currency: values.currency,
            category: values.category,
            expense_date: values.expense_date,
            description,
          },
        },
        { onSuccess: () => navigate(`/expenses/${id}`), onError: handleSubmitError },
      )
      return
    }

    // Plain update: send only the fields that actually changed so the audit
    // trail reflects the real diff. An unchanged edit is a no-op navigation
    // (the server rejects an empty update body).
    const body: Record<string, unknown> = {}
    if (values.title !== initial?.title) body.title = values.title
    if (values.amount !== initial?.amount) body.amount = values.amount
    if (values.currency !== initial?.currency) body.currency = values.currency
    if (values.category !== initial?.category) body.category = values.category
    if (values.expense_date !== initial?.expense_date?.slice(0, 10)) {
      body.expense_date = values.expense_date
    }
    if (description !== normalizeDescription(initial?.description)) body.description = description

    if (Object.keys(body).length === 0) {
      navigate(`/expenses/${id}`)
      return
    }
    updateExpense.mutate(
      { id, body },
      { onSuccess: () => navigate(`/expenses/${id}`), onError: handleSubmitError },
    )
  }

  // On edit, "Discard" returns to the detail page; on create, to the list.
  const handleDiscard = () => {
    if (isEdit && expenseId) {
      navigate(`/expenses/${expenseId}`)
    } else {
      navigate('/')
    }
  }

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">
          {isResubmit ? 'Resubmit expense' : isEdit ? 'Edit expense' : 'New expense'}
        </CardTitle>
        <CardDescription>
          {isResubmit
            ? 'Address the rejection feedback, then resubmit this expense for approval.'
            : isEdit
              ? 'Update the fields below and save your changes.'
              : 'Fill in the details and attach a receipt if available.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          data-testid="expense-form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-8"
        >
          {/* Submit-level error */}
          {submitError && (
            <p
              className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="expense-form-error"
            >
              <AlertCircle className="size-4 shrink-0" />
              {submitError}
            </p>
          )}

          {/* Details */}
          <Section title="Details">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title">
                Title <RequiredMark />
              </Label>
              <Input
                id="title"
                type="text"
                maxLength={255}
                placeholder="e.g. Team lunch, Flight to NYC"
                aria-required
                aria-invalid={!!errors.title}
                {...register('title')}
              />
              <FieldError message={errors.title?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                maxLength={5000}
                rows={3}
                placeholder="Optional context — purpose, attendees, vendor."
                aria-invalid={!!errors.description}
                {...register('description')}
              />
              <FieldError message={errors.description?.message} />
            </div>
          </Section>

          {/* Amount */}
          <Section title="Amount">
            <Controller
              control={control}
              name="currency"
              render={({ field }) => (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Amount with leading currency adornment */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="amount">
                      Amount <RequiredMark />
                    </Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground tabular-nums">
                        {field.value || '$'}
                      </span>
                      <Input
                        id="amount"
                        type="number"
                        min="0.01"
                        max="99999999.99"
                        step="0.01"
                        placeholder="0.00"
                        aria-required
                        aria-invalid={!!errors.amount}
                        className="pl-12 text-right font-mono tabular-nums"
                        {...register('amount')}
                      />
                    </div>
                    <FieldError message={errors.amount?.message} />
                  </div>

                  {/* Currency — ui Select (not touched by e2e) */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="currency">Currency</Label>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="currency"
                        className="w-full"
                        aria-invalid={!!errors.currency}
                      >
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCY_OPTIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError message={errors.currency?.message} />
                  </div>
                </div>
              )}
            />
          </Section>

          {/* Classification */}
          <Section title="Classification">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Category — MUST be a native <select> for Playwright selectOption */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="category">
                  Category <RequiredMark />
                </Label>
                <select
                  id="category"
                  aria-required
                  aria-invalid={!!errors.category}
                  className={cn(
                    nativeFieldCls,
                    'cursor-pointer',
                    errors.category && 'border-destructive',
                  )}
                  {...register('category')}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {formatCategory(c)}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.category?.message} />
              </div>

              {/* Expense date — MUST be a native <input type="date"> for Playwright fill */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense_date">
                  Date <RequiredMark />
                </Label>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="expense_date"
                    type="date"
                    max={maxExpenseDate}
                    min={minExpenseDate}
                    aria-required
                    aria-invalid={!!errors.expense_date}
                    className={cn(
                      nativeFieldCls,
                      'pr-9',
                      // Hide the browser's native calendar glyph so only our
                      // CalendarDays icon shows; the indicator stays clickable
                      // (it sits invisibly under our icon to open the picker).
                      '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-9 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0',
                      errors.expense_date && 'border-destructive',
                    )}
                    {...register('expense_date')}
                  />
                </div>
                <FieldError message={errors.expense_date?.message} />
              </div>
            </div>
          </Section>

          {/* Receipt — create mode only */}
          {!isEdit && (
            <Section title="Receipt" description="Attach a JPEG, PNG, or PDF up to 5 MB.">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="receipt-input">Receipt (optional)</Label>
                <FileDropzone onFile={setReceipt} />
              </div>
            </Section>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 border-t pt-6">
            <Button type="submit" data-testid="expense-submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {isSubmitting
                ? isResubmit
                  ? 'Resubmitting…'
                  : isEdit
                    ? 'Saving…'
                    : 'Submitting…'
                : isResubmit
                  ? 'Resubmit'
                  : isEdit
                    ? 'Save changes'
                    : 'Submit'}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="expense-discard"
              onClick={handleDiscard}
              disabled={isSubmitting}
            >
              Discard
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
