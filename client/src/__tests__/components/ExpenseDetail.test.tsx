import React from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'

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
// Auto-mock the auth context; control the return value per test.
jest.mock('@/context/AuthContext')

import api from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import ExpenseDetail from '@/components/expenses/ExpenseDetail'
import { renderWithProviders, makeMockAuthValue } from '../helpers/renderWithProviders'
import { mockUser, mockExpense, mockApiResponse } from '../helpers/factories'
import { Role, Status } from '@/types'
import type { Expense, Receipt, Comment } from '@/types'

const mockedGet = api.get as jest.Mock
const mockedPost = api.post as jest.Mock
const mockedPatch = api.patch as jest.Mock
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
})
