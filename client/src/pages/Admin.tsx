import { useState } from 'react'
import PageHeader from '@/components/common/PageHeader'
import AdminExpenses from '@/components/admin/AdminExpenses'
import UserManagement from '@/components/admin/UserManagement'
import AuditLog from '@/components/admin/AuditLog'
import { cn } from '@/lib/utils'

type Tab = 'expenses' | 'users' | 'audit'

const TABS: { key: Tab; label: string }[] = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'users', label: 'Users' },
  { key: 'audit', label: 'Audit log' },
]

export default function Admin() {
  const [tab, setTab] = useState<Tab>('expenses')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin"
        description="Expenses, users, and the audit trail."
      />

      {/* Custom tab buttons — e2e asserts toHaveClass(/active/) */}
      <nav
        className="flex gap-1 border-b"
        aria-label="Admin sections"
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            data-testid={`admin-tab-${key}`}
            aria-current={tab === key ? 'page' : undefined}
            className={cn(
              'relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              tab === key
                ? 'active text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Tab content — only mount expenses when that tab is active */}
      <div>
        {tab === 'expenses' && <AdminExpenses />}
        {tab === 'users' && <UserManagement />}
        {tab === 'audit' && <AuditLog />}
      </div>
    </div>
  )
}
