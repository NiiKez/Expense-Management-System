import PageHeader from '@/components/common/PageHeader'
import ExpenseForm from '../components/expenses/ExpenseForm'

export default function SubmitExpense() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New expense"
        description="File a new expense and attach a receipt if you have one."
      />
      <ExpenseForm mode="create" />
    </div>
  )
}
