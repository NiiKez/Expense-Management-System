import { Mail, Phone, MapPin, IdCard, UserRound, Users2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Role } from '@/types'
import type { OrgTreeNode } from '@/types'
import { useOrgUser } from '@/queries/org'

// Mirror the local initials helper used elsewhere (first two initials, uppercased).
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const roleVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  [Role.ADMIN]: 'default',
  [Role.MANAGER]: 'secondary',
  [Role.EMPLOYEE]: 'outline',
}

// One labelled field row. Renders nothing when the value is empty, so the modal
// only shows attributes we actually have.
function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  if (children == null || children === '') return null
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </div>
  )
}

interface OrgNodeDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The clicked node (instant header + a fallback if the fetch is slow/fails).
  node: OrgTreeNode | null
  // Resolved from the tree the caller already rendered — the endpoint doesn't
  // re-send structural data the client already has.
  managerName?: string | null
  directReportCount?: number
}

export default function OrgNodeDetailDialog({
  open,
  onOpenChange,
  node,
  managerName,
  directReportCount,
}: OrgNodeDetailDialogProps) {
  // Fetch lazily — only while the dialog is open for a node.
  const { data, isError } = useOrgUser(open && node ? node.id : null)

  // Prefer live detail, fall back to the clicked node so the header is instant.
  const displayName = data?.displayName ?? node?.displayName ?? ''
  const role = data?.role ?? node?.role
  const jobTitle = data?.jobTitle ?? node?.jobTitle ?? null
  const department = data?.department ?? node?.department ?? null
  const subtitle = [jobTitle, department].filter(Boolean).join(' · ')
  const phones = [data?.mobilePhone, ...(data?.businessPhones ?? [])].filter(Boolean) as string[]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              <AvatarFallback>{displayName ? initials(displayName) : '—'}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <DialogTitle className="truncate">{displayName || 'User'}</DialogTitle>
              {subtitle && <DialogDescription className="truncate">{subtitle}</DialogDescription>}
              {role && (
                <Badge variant={roleVariant[role] ?? 'outline'} className="mt-1 text-[10px]">
                  {role}
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Couldn&rsquo;t load this person&rsquo;s details.
          </p>
        ) : !data ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <span className="sr-only">Loading details&hellip;</span>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3">
              <Field icon={<Mail className="size-4" />} label="Email">
                {data.email ? (
                  <a className="text-primary hover:underline" href={`mailto:${data.email}`}>
                    {data.email}
                  </a>
                ) : null}
              </Field>
              <Field icon={<Phone className="size-4" />} label={phones.length > 1 ? 'Phone' : 'Phone'}>
                {phones.length > 0 ? phones.join(' · ') : null}
              </Field>
              <Field icon={<MapPin className="size-4" />} label="Office">
                {data.officeLocation}
              </Field>
              <Field icon={<IdCard className="size-4" />} label="Employee ID">
                {data.employeeId}
              </Field>
              <Field icon={<UserRound className="size-4" />} label="Manager">
                {managerName ?? null}
              </Field>
              <Field icon={<Users2 className="size-4" />} label="Direct reports">
                {directReportCount && directReportCount > 0 ? String(directReportCount) : null}
              </Field>
            </div>

            {data.groups.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">Groups</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.groups.map((g) => (
                    <Badge key={g.id} variant="outline" className="text-[10px]">
                      {g.name ?? g.id}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {data.source === 'local' && (
              <p className="text-xs text-muted-foreground">Profile shown from stored records.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
