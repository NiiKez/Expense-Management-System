import { Clock, CheckCircle2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Status } from '@/types'

type BadgeVariant = 'warning' | 'success' | 'danger'

const config: Record<Status, { variant: BadgeVariant; icon: typeof Clock }> = {
  PENDING: { variant: 'warning', icon: Clock },
  APPROVED: { variant: 'success', icon: CheckCircle2 },
  REJECTED: { variant: 'danger', icon: XCircle },
}

export default function StatusBadge({
  status,
  className,
  ...rest
}: { status: Status; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const { variant, icon: Icon } = config[status]

  return (
    <Badge variant={variant} className={cn('gap-1', className)} {...rest}>
      <Icon aria-hidden />
      {/* DOM text stays the raw uppercase status (tests assert it); the
          inline-block span lets ::first-letter render it as Title Case. */}
      <span className="inline-block lowercase first-letter:uppercase">{status}</span>
    </Badge>
  )
}
