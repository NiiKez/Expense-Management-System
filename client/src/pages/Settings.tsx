import { useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useMe, useUpdatePreferences } from '@/queries/me'
import type { User, UserPreferences } from '@/types'
import { CURRENCY_OPTIONS } from '@/lib/options'
import { formatDate } from '@/lib/format'
import PageHeader from '@/components/common/PageHeader'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ThemeToggle from '@/components/layout/ThemeToggle'

// Sentinel for "no preference" — radix Select can't use an empty-string value,
// and on the wire this maps to null (server falls back to the org base currency).
const NO_CURRENCY = '__none__'

interface PrefForm {
  currency: string
  notify_on_submission: boolean
  notify_on_decision: boolean
  notify_on_comment: boolean
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function toForm(p: UserPreferences): PrefForm {
  return {
    currency: p.default_currency ?? NO_CURRENCY,
    notify_on_submission: p.notify_on_submission,
    notify_on_decision: p.notify_on_decision,
    notify_on_comment: p.notify_on_comment,
  }
}

// A labeled read-only field for the profile card.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  )
}

// A switch row with a label + helper text.
function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  testId,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  testId: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  )
}

export default function Settings() {
  const { data: profile, isPending: loading, isError: error } = useMe()
  const updatePreferences = useUpdatePreferences()
  const saving = updatePreferences.isPending

  const [form, setForm] = useState<PrefForm | null>(null)
  const [initial, setInitial] = useState<PrefForm | null>(null)
  // Tracks which profile object the form was seeded from, so we re-seed exactly
  // once when `useMe` resolves (or refetches a new identity) — the React-docs
  // "adjusting state during render" pattern, no effect required.
  const [seededFrom, setSeededFrom] = useState<User | null>(null)

  if (profile && profile !== seededFrom) {
    const prefs: UserPreferences = {
      default_currency: profile.default_currency ?? null,
      notify_on_submission: profile.notify_on_submission ?? true,
      notify_on_decision: profile.notify_on_decision ?? true,
      notify_on_comment: profile.notify_on_comment ?? true,
    }
    setForm(toForm(prefs))
    setInitial(toForm(prefs))
    setSeededFrom(profile)
  }

  const dirty = !!form && !!initial && JSON.stringify(form) !== JSON.stringify(initial)

  const update = <K extends keyof PrefForm>(key: K, value: PrefForm[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  const handleSave = () => {
    if (!form) return
    const body: UserPreferences = {
      default_currency: form.currency === NO_CURRENCY ? null : form.currency,
      notify_on_submission: form.notify_on_submission,
      notify_on_decision: form.notify_on_decision,
      notify_on_comment: form.notify_on_comment,
    }
    updatePreferences.mutate(body, {
      onSuccess: (saved) => {
        if (saved) {
          setForm(toForm(saved))
          setInitial(toForm(saved))
        } else {
          setInitial(form)
        }
        toast.success('Settings saved.')
      },
      onError: () => {
        toast.error('Could not save your settings. Please try again.')
      },
    })
  }

  return (
    <div className="space-y-6" data-testid="settings-page">
      <PageHeader title="Settings" description="Manage your profile and notification preferences." />

      {loading ? (
        <div className="space-y-6" role="status" aria-live="polite">
          <span className="sr-only">Loading settings…</span>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error || !profile || !form ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <AlertTriangle className="size-5 text-destructive" />
            We couldn't load your settings. Please refresh and try again.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Profile — read-only (sourced from Microsoft Entra ID) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
              <CardDescription>
                Your name, email, role, and manager are managed by your organization (Microsoft
                Entra ID) and can't be edited here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="size-12">
                  <AvatarFallback className="text-base">{initials(profile.display_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{profile.display_name}</p>
                  <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
                </div>
                <Badge variant="secondary" className="ml-auto text-[10px] uppercase tracking-wide">
                  {profile.role}
                </Badge>
              </div>

              <Separator />

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="Manager">{profile.manager_name ?? '—'}</Field>
                <Field label="Member since">
                  {profile.created_at ? formatDate(profile.created_at) : '—'}
                </Field>
              </div>
            </CardContent>
          </Card>

          {/* Preferences — editable */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preferences</CardTitle>
              <CardDescription>Defaults and notifications for your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {/* Default currency */}
              <section className="space-y-2">
                <Label htmlFor="pref-currency" className="text-sm font-medium">
                  Default currency
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pre-selected when you create a new expense.
                </p>
                <Select value={form.currency} onValueChange={(v) => update('currency', v)}>
                  <SelectTrigger id="pref-currency" className="w-full sm:w-60" data-testid="pref-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CURRENCY}>No preference (USD)</SelectItem>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>

              <Separator />

              {/* Notifications */}
              <section>
                <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
                <p className="mb-1 text-xs text-muted-foreground">
                  Choose which in-app notifications you receive.
                </p>
                <div className="divide-y">
                  <ToggleRow
                    id="notify-submission"
                    testId="pref-notify-submission"
                    label="Submissions awaiting my approval"
                    description="When someone on your team submits or resubmits an expense for you to review."
                    checked={form.notify_on_submission}
                    onChange={(v) => update('notify_on_submission', v)}
                  />
                  <ToggleRow
                    id="notify-decision"
                    testId="pref-notify-decision"
                    label="Decisions on my expenses"
                    description="When one of your expenses is approved or rejected."
                    checked={form.notify_on_decision}
                    onChange={(v) => update('notify_on_decision', v)}
                  />
                  <ToggleRow
                    id="notify-comment"
                    testId="pref-notify-comment"
                    label="Comments on my expenses"
                    description="When someone comments on an expense you submitted."
                    checked={form.notify_on_comment}
                    onChange={(v) => update('notify_on_comment', v)}
                  />
                </div>
              </section>

              <Separator />

              {/* Appearance */}
              <section className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-medium text-foreground">Appearance</h3>
                  <p className="text-xs text-muted-foreground">
                    Switch between light and dark. Saved on this device.
                  </p>
                </div>
                <ThemeToggle />
              </section>

              <div className="flex items-center gap-3 border-t pt-6">
                <Button onClick={handleSave} disabled={!dirty || saving} data-testid="settings-save">
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
                {!dirty && !saving && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5" /> All changes saved
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
