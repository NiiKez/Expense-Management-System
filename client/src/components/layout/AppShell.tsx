import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { AppErrorBoundary } from '@/components/common/ErrorBoundary'

interface AppShellProps {
  title?: string
  children: ReactNode
}

export default function AppShell({ title, children }: AppShellProps) {
  return (
    <div className="flex h-svh overflow-hidden bg-background">
      {/* Keyboard users can jump past the repeated sidebar/topbar nav straight to content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-8 outline-none md:px-8"
        >
          <div className="mx-auto w-full max-w-screen-xl">
            {/* A crash in the routed page shows a recovery UI here while the
                sidebar/topbar stay usable. */}
            <AppErrorBoundary>{children}</AppErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
