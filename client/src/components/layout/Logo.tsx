import { cn } from '@/lib/utils'

interface LogoProps {
  /** When true, render only the logomark (no wordmark). */
  collapsed?: boolean
  /** Size of the square logomark in pixels. */
  size?: number
  className?: string
}

/**
 * Brand lockup: a geometric "E" monogram in a rounded indigo-violet square
 * plus the "Expense Management" wordmark. Used in the sidebar, mobile sheet,
 * and login screen.
 */
export default function Logo({ collapsed = false, size = 32, className }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="size-[60%]"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Geometric "E" monogram built from three rounded bars */}
          <rect x="6" y="5" width="12" height="2.6" rx="1.3" fill="currentColor" />
          <rect x="6" y="10.7" width="9" height="2.6" rx="1.3" fill="currentColor" />
          <rect x="6" y="16.4" width="12" height="2.6" rx="1.3" fill="currentColor" />
        </svg>
      </span>
      {!collapsed && (
        <span className="truncate text-sm font-semibold tracking-tight text-foreground">
          Expense Management
        </span>
      )}
    </div>
  )
}
