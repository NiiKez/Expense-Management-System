import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      data-testid="theme-toggle"
      className="relative overflow-hidden"
    >
      {/* Two stacked icons; rotate + scale + fade between them on theme change. */}
      <Sun
        className="absolute size-[18px] transition-all duration-300 ease-[--ease-out-quart] rotate-0 scale-100 opacity-100 dark:-rotate-90 dark:scale-0 dark:opacity-0"
      />
      <Moon
        className="absolute size-[18px] transition-all duration-300 ease-[--ease-out-quart] rotate-90 scale-0 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100"
      />
      <span className="sr-only">{isDark ? 'Switch to light mode' : 'Switch to dark mode'}</span>
    </Button>
  )
}
