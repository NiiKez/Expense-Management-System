import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../helpers/renderWithProviders'
import type { OrgTree } from '../../types'

// Prevent PublicClientApplication construction (needs Web Crypto, absent in jsdom).
jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
jest.mock('@/services/api')
import api from '@/services/api'
import { useOrgTree, useOrgUser, orgKeys } from '@/queries/org'
import type { OrgUserDetail } from '../../types'

const mockedApi = api as jest.Mocked<typeof api>

function makeWrapper() {
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

const tree: OrgTree = {
  scope: 'MANAGER',
  rootIds: [1],
  truncated: false,
  syncedAt: '2024-01-01T00:00:00Z',
  nodes: [
    {
      id: 1,
      displayName: 'Alice',
      role: 'MANAGER',
      jobTitle: null,
      department: null,
      managerId: null,
      isActive: true,
    },
  ],
}

beforeEach(() => jest.clearAllMocks())

describe('useOrgTree', () => {
  it('GETs /org/tree and returns the unwrapped tree', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: tree } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOrgTree(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/org/tree', { params: undefined })
    expect(result.current.data).toEqual(tree)
  })

  it('passes maxDepth through as a query param', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: tree } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOrgTree({ maxDepth: 3 }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/org/tree', { params: { maxDepth: 3 } })
  })

  it('does not fetch when disabled', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useOrgTree({ enabled: false }), { wrapper })
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('builds a stable query key that includes maxDepth', () => {
    expect(orgKeys.tree()).toEqual(['org', 'tree', null])
    expect(orgKeys.tree(4)).toEqual(['org', 'tree', 4])
  })
})

const userDetail: OrgUserDetail = {
  id: 3,
  displayName: 'Jordan Lee',
  role: 'EMPLOYEE',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  email: 'jordan@corp.com',
  officeLocation: 'San Francisco',
  employeeId: 'E-0003',
  mobilePhone: '+1 555 0100',
  businessPhones: [],
  isActive: true,
  groups: [{ id: 'g1', name: 'Engineering' }],
  source: 'directory',
}

describe('useOrgUser', () => {
  it('GETs /org/users/:id and returns the unwrapped detail', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: userDetail } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOrgUser(3), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/org/users/3')
    expect(result.current.data).toEqual(userDetail)
  })

  it('does not fetch when the id is null (dialog closed)', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useOrgUser(null), { wrapper })
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('keys the query by user id', () => {
    expect(orgKeys.user(3)).toEqual(['org', 'user', 3])
  })
})
