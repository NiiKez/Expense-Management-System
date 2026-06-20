import { useAuth } from '@/context/AuthContext'
import { Role } from '@/types'
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard'
import ManagerDashboard from '@/components/dashboard/ManagerDashboard'
import AdminDashboard from '@/components/dashboard/AdminDashboard'

function timeOfDayGreeting() {
  const hour = new Date().getHours()
  if (hour < 5) return 'Good evening'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { user } = useAuth()

  const greeting = `${timeOfDayGreeting()}, ${user?.display_name ?? 'there'}`

  return (
    <div data-testid="dashboard" className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here is an overview of your expense activity.
        </p>
      </div>

      {user?.role === Role.EMPLOYEE && <EmployeeDashboard />}
      {user?.role === Role.MANAGER && <ManagerDashboard />}
      {user?.role === Role.ADMIN && <AdminDashboard />}
    </div>
  )
}
