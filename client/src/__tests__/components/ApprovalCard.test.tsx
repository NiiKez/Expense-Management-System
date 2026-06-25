import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../helpers/renderWithProviders'
import { mockExpense } from '../helpers/factories'
import ApprovalCard from '@/components/approval/ApprovalCard'

// ApprovalCard takes the approve/reject mutations as plain async callbacks (the
// Approvals page wires them to the real mutations and already covers the happy
// path). Here we drive those callbacks directly to exercise the validation guards
// and the failure branches the page test can't easily reach.
function renderCard(
  onApprove: jest.Mock = jest.fn().mockResolvedValue(undefined),
  onReject: jest.Mock = jest.fn().mockResolvedValue(undefined),
) {
  renderWithProviders(
    <ApprovalCard expense={mockExpense({ id: 1, title: 'Team Lunch' })} onApprove={onApprove} onReject={onReject} />,
  )
  return { onApprove, onReject }
}

describe('ApprovalCard — reject validation guards', () => {
  it('blocks a whitespace-only reason and does not call onReject', async () => {
    const user = userEvent.setup()
    const { onReject } = renderCard()

    await user.click(screen.getByTestId('approval-reject-1'))
    // Whitespace-only trims to empty → the "required" guard, not the length guard.
    fireEvent.change(screen.getByTestId('approval-reject-reason-1'), { target: { value: '   ' } })
    await user.click(screen.getByTestId('approval-confirm-reject-1'))

    expect(screen.getByTestId('approval-error-1')).toHaveTextContent('A reason is required.')
    expect(onReject).not.toHaveBeenCalled()
  })

  it('blocks a reason longer than 500 characters and does not call onReject', async () => {
    const user = userEvent.setup()
    const { onReject } = renderCard()

    await user.click(screen.getByTestId('approval-reject-1'))
    // fireEvent.change bypasses the textarea maxLength so the component's own
    // length guard (not the browser cap) is what's exercised.
    fireEvent.change(screen.getByTestId('approval-reject-reason-1'), { target: { value: 'a'.repeat(501) } })
    await user.click(screen.getByTestId('approval-confirm-reject-1'))

    expect(screen.getByTestId('approval-error-1')).toHaveTextContent(
      'Reason must be 500 characters or fewer.',
    )
    expect(onReject).not.toHaveBeenCalled()
  })
})

describe('ApprovalCard — mutation failure branches', () => {
  it('shows an approve-failure message when onApprove rejects', async () => {
    const user = userEvent.setup()
    const onApprove = jest.fn().mockRejectedValue(new Error('network'))
    renderCard(onApprove)

    await user.click(screen.getByTestId('approval-approve-1'))

    expect(await screen.findByTestId('approval-error-1')).toHaveTextContent('Failed to approve expense.')
    expect(onApprove).toHaveBeenCalledWith(1)
    // loading is reset in finally → the button is interactive again.
    expect(screen.getByTestId('approval-approve-1')).toBeEnabled()
  })

  it('shows a reject-failure message when onReject rejects (with a valid reason)', async () => {
    const user = userEvent.setup()
    const onReject = jest.fn().mockRejectedValue(new Error('network'))
    renderCard(undefined, onReject)

    await user.click(screen.getByTestId('approval-reject-1'))
    await user.type(screen.getByTestId('approval-reject-reason-1'), 'Out of policy')
    await user.click(screen.getByTestId('approval-confirm-reject-1'))

    expect(await screen.findByTestId('approval-error-1')).toHaveTextContent('Failed to reject expense.')
    expect(onReject).toHaveBeenCalledWith(1, 'Out of policy')
  })

  it('disables the approve button and shows the loading label while the mutation is in flight', async () => {
    const user = userEvent.setup()
    // A controllable promise keeps the mutation pending so the loading branch is observable.
    let resolve!: () => void
    const onApprove = jest.fn(() => new Promise<void>((r) => (resolve = r)))
    renderCard(onApprove)

    await user.click(screen.getByTestId('approval-approve-1'))

    const approveBtn = screen.getByTestId('approval-approve-1')
    expect(approveBtn).toBeDisabled()
    expect(approveBtn).toHaveTextContent('Approving…')

    resolve()
    await waitFor(() => expect(screen.getByTestId('approval-approve-1')).toBeEnabled())
  })
})

describe('ApprovalCard — cancel resets reject state', () => {
  it('cancel closes the form and clears both the typed reason and any error', async () => {
    const user = userEvent.setup()
    const { onReject } = renderCard()

    await user.click(screen.getByTestId('approval-reject-1'))

    // Force an error (empty-reason guard) and type a draft so we can prove cancel
    // wipes BOTH the error and the reason — without ever submitting.
    await user.click(screen.getByTestId('approval-confirm-reject-1'))
    expect(screen.getByTestId('approval-error-1')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('approval-reject-reason-1'), { target: { value: 'draft text' } })

    await user.click(screen.getByTestId('approval-cancel-reject-1'))

    // Form unmounted, the error is cleared, and onReject was never called.
    expect(screen.queryByTestId('approval-reject-reason-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approval-error-1')).not.toBeInTheDocument()
    expect(onReject).not.toHaveBeenCalled()

    // Reopening shows an empty reason field — the draft was discarded, not retained.
    await user.click(screen.getByTestId('approval-reject-1'))
    expect(screen.getByTestId('approval-reject-reason-1')).toHaveValue('')
  })
})
