import * as React from "react"

import { cn } from "@/lib/utils"

const SHIMMER_KEYFRAMES = `@keyframes skeleton-shimmer {
  100% { transform: translateX(100%); }
}`

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        "motion-reduce:before:hidden",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-[linear-gradient(90deg,transparent,var(--color-foreground),transparent)]",
        "before:opacity-[0.06] before:[animation:skeleton-shimmer_1.6s_infinite]",
        className
      )}
      {...props}
    >
      <style>{SHIMMER_KEYFRAMES}</style>
    </div>
  )
}

export { Skeleton }
