import { useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { searchOrg, type OrgIndex } from './tree'

interface OrgSearchProps {
  index: OrgIndex
  // Called with the chosen person's id — the chart reveals and centres them.
  onSelect: (id: number) => void
}

/**
 * "Find a person" combobox for the org chart: type a name, job title or
 * department, pick a match with the mouse or ↑/↓ + Enter.
 */
export default function OrgSearch({ index, onSelect }: OrgSearchProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const results = useMemo(() => searchOrg(index, query), [index, query])
  const showList = open && query.trim() !== ''

  const choose = (id: number) => {
    onSelect(id)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!showList || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[active]
      if (hit) choose(hit.id)
    }
  }

  return (
    <div className="relative w-full sm:w-72">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        role="combobox"
        aria-label="Find a person"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && results[active] ? `${listId}-${results[active].id}` : undefined}
        placeholder="Find a person…"
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-8 pl-8"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching people"
          className="absolute top-full left-0 z-30 mt-1.5 max-h-80 w-full min-w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {results.length === 0 ? (
            <li role="presentation" className="px-2.5 py-3 text-xs text-muted-foreground">
              No one matches &ldquo;{query.trim()}&rdquo;.
            </li>
          ) : (
            results.map((n, i) => {
              const subtitle = [n.jobTitle, n.department].filter(Boolean).join(' · ')
              return (
                <li
                  key={n.id}
                  id={`${listId}-${n.id}`}
                  role="option"
                  aria-selected={i === active}
                  // Keep focus in the input so the blur handler doesn't close
                  // the list before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(n.id)}
                  className={cn(
                    'cursor-pointer rounded-md px-2.5 py-1.5',
                    i === active && 'bg-accent text-accent-foreground',
                  )}
                >
                  <p className="truncate text-sm font-medium">{n.displayName}</p>
                  {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
