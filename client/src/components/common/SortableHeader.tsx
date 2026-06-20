import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { SortState } from '@/lib/sort'

interface SortableHeaderProps {
  label: string
  sortKey: string
  sort: SortState
  onSort: (key: string) => void
  align?: 'left' | 'right'
  className?: string
}

/**
 * A clickable table header that drives server-side sorting. Shows a neutral
 * icon until its column is the active sort, then an up/down arrow. The
 * `aria-sort` attribute is set on the <th> for assistive tech.
 */
export default function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
  className,
}: SortableHeaderProps) {
  const active = sort.key === sortKey
  const Icon = active ? (sort.order === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown

  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        data-testid={`sort-${sortKey}`}
        aria-label={
          active
            ? `Sort by ${label}, currently ${sort.order === 'asc' ? 'ascending' : 'descending'}`
            : `Sort by ${label}`
        }
        className={cn(
          'group -mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-wide transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          align === 'right' && 'w-full flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        {label}
        <Icon
          className={cn('size-3.5 shrink-0', !active && 'opacity-40 group-hover:opacity-70')}
          aria-hidden
        />
      </button>
    </TableHead>
  )
}
