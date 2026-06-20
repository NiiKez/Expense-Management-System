import type { ReactNode, HTMLAttributes } from 'react'

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({ icon, title, description, action, ...rest }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16 text-center text-muted-foreground"
      {...rest}
    >
      {icon && (
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:size-6">
          {icon}
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-base font-medium text-foreground">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
