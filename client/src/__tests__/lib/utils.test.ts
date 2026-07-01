import { cn } from '@/lib/utils'

describe('cn', () => {
  it('lets a later conflicting Tailwind class win the merge', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('drops falsy conditional classes and keeps the truthy ones', () => {
    // Mirrors real usage: `cn('a', isActive && 'b', maybeClass, 'c')` where the
    // conditionals resolve to falsy. Use variables so the falsy operands aren't
    // constant expressions (which clsx/cn drop just the same).
    const isActive: boolean = false
    const maybeClass: string | undefined = undefined
    expect(cn('a', isActive && 'b', maybeClass, 'c')).toBe('a c')
  })
})
