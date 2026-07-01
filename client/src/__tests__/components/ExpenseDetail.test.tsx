import React from 'react'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'

// Radix Dialog's focus/scroll-lock machinery relies on DOM APIs jsdom omits.
// Scoped here so the delete/reject dialogs and the preview dialog can open.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

// jsdom implements neither URL.createObjectURL nor revokeObjectURL, yet the
// receipt preview/download build object URLs. Mock both so the lifecycle is
// observable and doesn't throw "Not implemented".
const createObjectURL = jest.fn(() => 'blob:mock-url')
const revokeObjectURL = jest.fn()
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true })
})

// ── Required mocks (per the Phase B contract) ─────────────────────────────────
jest.mock('@/services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}))
jest.mock('@/services/auth', () => ({
  msalInstance: {
    getActiveAccount: () => null,
    getAllAccounts: () => [],
    acquireTokenSilent: jest.fn(),
    acquireTokenRedirect: jest.fn(),
  },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
// Toast is mocked so success/error feedback is assertable.
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
// Navigation (delete/back) is asserted via a mocked useNavigate; the rest of
// react-router-dom (Routes/Route/Link) stays real.
const mockNavigate = jest.fn()
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}))
// Auto-mock the auth context; control the return value per test.
jest.mock('@/context/AuthContext')

import api from '@/services/api'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import ExpenseDetail from '@/components/expenses/ExpenseDetail'
import { renderWithProviders, makeMockAuthValue } from '../helpers/renderWithProviders'
import { mockUser, mockExpense, mockApiResponse } from '../helpers/factories'
import { Role, Status } from '@/types'
import type { Expense, Receipt, Comment } from '@/types'

const mockedGet = api.get as jest.Mock
const mockedPost = api.post as jest.Mock
const mockedPatch = api.patch as jest.Mock
const mockedDelete = api.delete as jest.Mock
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>

// ── Fixtures ──────────────────────────────────────────────────────────────────

function detailExpense(overrides: Partial<Expense> & { receipts?: Receipt[] } = {}) {
  const { receipts = [], ...rest } = overrides
  return { ...mockExpense({ id: 7, submitted_by: 1, ...rest }), receipts }
}

function mockComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    expense_id: 7,
    author_id: 1,
    author_name: 'Alice Example',
    author_role: Role.EMPLOYEE,
    body: 'Looks good to me.',
    created_at: '2024-03-15T11:00:00Z',
    ...overrides,
  }
}

function mockReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 3,
    expense_id: 7,
    file_name: 'receipt.png',
    file_path: '/uploads/receipt.png',
    mime_type: 'image/png',
    file_size: 2048,
    uploaded_at: '2024-03-15T10:00:00Z',
    ...overrides,
  }
}

/**
 * Wires the GET handlers for the detail + comments endpoints. Any test can
 * override the resolved values via the arguments.
 */
function primeGet(
  expense: ReturnType<typeof detailExpense> | null,
  comments: Comment[] = [],
) {
  mockedGet.mockImplementation((url: string) => {
    if (/\/comments$/.test(url)) {
      return Promise.resolve({ data: mockApiResponse(comments) })
    }
    return Promise.resolve({ data: mockApiResponse(expense) })
  })
}

/**
 * Like primeGet, but also answers the imperative receipt-blob GET
 * (`/expenses/{id}/receipts/{rid}`) so preview/download paths can resolve.
 */
function primeReceiptGet(expense: ReturnType<typeof detailExpense>, blob: Blob) {
  mockedGet.mockImplementation((url: string) => {
    if (/\/receipts\//.test(url)) return Promise.resolve({ data: blob })
    if (/\/comments$/.test(url)) return Promise.resolve({ data: mockApiResponse([]) })
    return Promise.resolve({ data: mockApiResponse(expense) })
  })
}

function renderDetail(id = '7') {
  return renderWithProviders(
    <Routes>
      <Route path="/expenses/:id" element={<ExpenseDetail />} />
    </Routes>,
    { initialEntries: [`/expenses/${id}`] },
  )
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedPost.mockReset()
  mockedPatch.mockReset()
  mockedDelete.mockReset()
  mockNavigate.mockReset()
  ;(toast.success as jest.Mock).mockClear()
  ;(toast.error as jest.Mock).mockClear()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  // Default viewer: the owner (employee, id 1).
  mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ id: 1, role: Role.EMPLOYEE }) }))
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ExpenseDetail', () => {
  it('renders an expense once loaded', async () => {
    primeGet(detailExpense({ title: 'Conference travel' }))
    renderDetail()

    expect(await screen.findByTestId('expense-detail-title')).toHaveTextContent('Conference travel')
    expect(screen.getByText('No comments yet. Start the conversation below.')).toBeInTheDocument()
  })

  it('shows Edit and Delete for the owner of a pending expense', async () => {
    primeGet(detailExpense({ submitted_by: 1, status: Status.PENDING }))
    renderDetail()

    expect(await screen.findByTestId('detail-edit')).toBeInTheDocument()
    expect(screen.getByTestId('detail-delete')).toBeInTheDocument()
    // Owner does not see approval actions.
    expect(screen.queryByTestId('detail-approve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('detail-reject')).not.toBeInTheDocument()
  })

  it('shows Approve/Reject to a manager viewing someone else’s pending expense, and Approve calls the approvals endpoint', async () => {
    // Manager (id 2) viewing an expense submitted by user 1.
    mockUseAuth.mockReturnValue(
      makeMockAuthValue({ user: mockUser({ id: 2, role: Role.MANAGER }) }),
    )
    primeGet(detailExpense({ submitted_by: 1, status: Status.PENDING }))
    mockedPatch.mockResolvedValue({ data: { success: true } })

    renderDetail()

    const approveBtn = await screen.findByTestId('detail-approve')
    expect(approveBtn).toBeInTheDocument()
    expect(screen.getByTestId('detail-reject')).toBeInTheDocument()
    // Not the owner → no owner actions.
    expect(screen.queryByTestId('detail-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('detail-delete')).not.toBeInTheDocument()

    await userEvent.click(approveBtn)

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/approvals/7/approve'),
    )
  })

  it('posts a comment via the comments endpoint and clears the input', async () => {
    primeGet(detailExpense())
    mockedPost.mockResolvedValue({
      data: mockApiResponse(mockComment({ id: 99, body: 'Thanks!' })),
    })

    renderDetail()

    const input = await screen.findByTestId('comment-input')
    await userEvent.type(input, 'Thanks!')
    await userEvent.click(screen.getByTestId('comment-submit'))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/expenses/7/comments', { body: 'Thanks!' }),
    )
    // The just-posted comment lands in the thread (hook appends to cache).
    await waitFor(() =>
      expect(within(screen.getByTestId('comment-list')).getByText('Thanks!')).toBeInTheDocument(),
    )
    // Input is cleared on success.
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('renders the invalid-reference message for a non-integer id', async () => {
    primeGet(detailExpense())
    renderDetail('abc')

    expect(await screen.findByText('Invalid expense reference.')).toBeInTheDocument()
    // No request is fired for an invalid id.
    expect(mockedGet).not.toHaveBeenCalled()
  })

  // ── Load-state branches ───────────────────────────────────────────────────
  it('renders the loading skeleton while the expense query is pending', () => {
    // A never-settling GET keeps the query pending → the skeleton branch shows.
    mockedGet.mockReturnValue(new Promise(() => {}))
    renderDetail()

    expect(screen.getByText('Loading expense…')).toBeInTheDocument()
  })

  it('renders the load-failure message when the expense query errors', async () => {
    mockedGet.mockImplementation((url: string) => {
      if (/\/comments$/.test(url)) return Promise.resolve({ data: mockApiResponse([]) })
      return Promise.reject(new Error('boom'))
    })
    renderDetail()

    expect(await screen.findByText('Failed to load expense details.')).toBeInTheDocument()
  })

  // ── Delete ────────────────────────────────────────────────────────────────
  it('deletes on confirm, toasts success, and navigates home', async () => {
    primeGet(detailExpense({ submitted_by: 1, status: Status.PENDING }))
    mockedDelete.mockResolvedValue({ data: { success: true } })
    renderDetail()

    fireEvent.click(await screen.findByTestId('detail-delete'))
    fireEvent.click(await screen.findByTestId('detail-confirm-delete'))

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('/expenses/7'))
    expect(toast.success).toHaveBeenCalledWith('Expense deleted successfully.')
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('disables the delete controls while the deletion is in flight', async () => {
    primeGet(detailExpense({ submitted_by: 1, status: Status.PENDING }))
    mockedDelete.mockReturnValue(new Promise(() => {})) // never settles → stays pending
    renderDetail()

    fireEvent.click(await screen.findByTestId('detail-delete'))
    fireEvent.click(await screen.findByTestId('detail-confirm-delete'))

    await waitFor(() => expect(screen.getByTestId('detail-confirm-delete')).toBeDisabled())
    expect(screen.getByTestId('detail-confirm-delete')).toHaveTextContent('Deleting…')
  })

  // ── Reject (reason required) ──────────────────────────────────────────────
  it('blocks rejection with an empty reason and shows the required-reason error', async () => {
    mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ id: 2, role: Role.MANAGER }) }))
    primeGet(detailExpense({ submitted_by: 1, status: Status.PENDING }))
    renderDetail()

    fireEvent.click(await screen.findByTestId('detail-reject'))
    fireEvent.click(await screen.findByTestId('detail-confirm-reject'))

    expect(await screen.findByText('A reason is required.')).toBeInTheDocument()
    // The guard blocks the request entirely.
    expect(mockedPatch).not.toHaveBeenCalled()
  })

  it('rejects with a reason via the approvals endpoint and toasts success', async () => {
    mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ id: 2, role: Role.MANAGER }) }))
    primeGet(detailExpense({ submitted_by: 1, status: Status.PENDING }))
    mockedPatch.mockResolvedValue({ data: { success: true } })
    renderDetail()

    fireEvent.click(await screen.findByTestId('detail-reject'))
    fireEvent.change(await screen.findByTestId('detail-reject-reason'), {
      target: { value: 'Missing itemized receipt' },
    })
    fireEvent.click(screen.getByTestId('detail-confirm-reject'))

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/approvals/7/reject', {
        reason: 'Missing itemized receipt',
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('Expense rejected.')
  })

  it('disables the reject confirm while the rejection is in flight', async () => {
    mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ id: 2, role: Role.MANAGER }) }))
    primeGet(detailExpense({ submitted_by: 1, status: Status.PENDING }))
    mockedPatch.mockReturnValue(new Promise(() => {}))
    renderDetail()

    fireEvent.click(await screen.findByTestId('detail-reject'))
    fireEvent.change(await screen.findByTestId('detail-reject-reason'), {
      target: { value: 'Needs manager sign-off' },
    })
    fireEvent.click(screen.getByTestId('detail-confirm-reject'))

    await waitFor(() => expect(screen.getByTestId('detail-confirm-reject')).toBeDisabled())
    expect(screen.getByTestId('detail-confirm-reject')).toHaveTextContent('Rejecting…')
  })

  // ── Approve (pending state) ───────────────────────────────────────────────
  it('disables the approve button while the approval is in flight', async () => {
    mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ id: 2, role: Role.MANAGER }) }))
    primeGet(detailExpense({ submitted_by: 1, status: Status.PENDING }))
    mockedPatch.mockReturnValue(new Promise(() => {}))
    renderDetail()

    fireEvent.click(await screen.findByTestId('detail-approve'))

    await waitFor(() => expect(screen.getByTestId('detail-approve')).toBeDisabled())
    expect(screen.getByTestId('detail-approve')).toHaveTextContent('Approving…')
  })

  // ── Approval visibility ───────────────────────────────────────────────────
  it('hides approval actions from a manager viewing their own expense', async () => {
    // Manager (id 2) viewing an expense they themselves submitted → owner, so
    // no approve/reject; they get the owner actions instead.
    mockUseAuth.mockReturnValue(makeMockAuthValue({ user: mockUser({ id: 2, role: Role.MANAGER }) }))
    primeGet(detailExpense({ submitted_by: 2, status: Status.PENDING }))
    renderDetail()

    await screen.findByTestId('expense-detail-title')
    expect(screen.queryByTestId('detail-approve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('detail-reject')).not.toBeInTheDocument()
    expect(screen.getByTestId('detail-edit')).toBeInTheDocument()
  })

  it('shows the Edit & resubmit link to the owner of a rejected expense', async () => {
    primeGet(detailExpense({ submitted_by: 1, status: Status.REJECTED }))
    renderDetail()

    const link = await screen.findByTestId('detail-resubmit')
    expect(link).toHaveTextContent('Edit & resubmit')
    // The CTA routes into the edit/resubmit form.
    expect(link).toHaveAttribute('href', '/expenses/7/edit')
  })

  // ── Receipt preview / download ────────────────────────────────────────────
  it('opens the preview dialog for an image and fetches the blob', async () => {
    const receipt = mockReceipt({ id: 3, mime_type: 'image/png', file_name: 'lunch.png' })
    primeReceiptGet(detailExpense({ receipts: [receipt] }), new Blob(['img'], { type: 'image/png' }))
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    // The dialog opens with the object-URL-backed image.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByAltText('Receipt preview')).toHaveAttribute('src', 'blob:mock-url')
    expect(mockedGet).toHaveBeenCalledWith('/expenses/7/receipts/3', { responseType: 'blob' })
  })

  it('shows the not-available error and skips the fetch for an invalid receipt reference', async () => {
    // id 0 is an invalid receipt reference; the Preview button still renders for an
    // image mime, but the handler's guard blocks the fetch and surfaces the error.
    const receipt = mockReceipt({ id: 0, mime_type: 'image/png' })
    primeReceiptGet(detailExpense({ receipts: [receipt] }), new Blob([], { type: 'image/png' }))
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(
      await screen.findByText('Receipt preview is not available for this file.'),
    ).toBeInTheDocument()
    expect(mockedGet).not.toHaveBeenCalledWith('/expenses/7/receipts/0', { responseType: 'blob' })
  })

  it('downloads a receipt via a blob fetch and an anchor click', async () => {
    const receipt = mockReceipt({ id: 4, mime_type: 'application/pdf', file_name: 'invoice.pdf' })
    primeReceiptGet(
      detailExpense({ receipts: [receipt] }),
      new Blob(['pdf'], { type: 'application/pdf' }),
    )
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/expenses/7/receipts/4', { responseType: 'blob' }),
    )
    expect(createObjectURL).toHaveBeenCalled()
    expect(anchorClick).toHaveBeenCalledTimes(1)
    anchorClick.mockRestore()
  })

  it('offers neither Preview nor Download for a receipt whose type is not allowed', async () => {
    // image/gif is neither previewable (jpeg/png) nor downloadable (jpeg/png/pdf).
    const receipt = mockReceipt({ id: 5, mime_type: 'image/gif', file_name: 'anim.gif' })
    primeReceiptGet(detailExpense({ receipts: [receipt] }), new Blob([], { type: 'image/gif' }))
    renderDetail()

    expect(await screen.findByText('anim.gif')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument()
  })
})
