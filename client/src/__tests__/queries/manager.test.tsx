import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../helpers/renderWithProviders'
import type { ManagerStats } from '../../types'

jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
jest.mock('@/services/api')
import api from '@/services/api'
import { useManagerStats } from '@/queries/manager'

const mockedApi = api as jest.Mocked<typeof api>

function makeWrapper() {
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

const managerStats: ManagerStats = {
  pendingApprovals: 2,
  teamSize: 4,
  teamSpendMonth: 500,
  approvedMonth: 3,
  baseCurrency: 'USD',
  byCategory: [],
  monthly: [],
}

beforeEach(() => jest.clearAllMocks())

describe('useManagerStats', () => {
  it('GETs /manager/stats and returns the unwrapped stats', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: managerStats } })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useManagerStats(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/manager/stats')
    expect(result.current.data).toEqual(managerStats)
  })

  it('does not fetch when disabled', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useManagerStats({ enabled: false }), { wrapper })
    expect(mockedApi.get).not.toHaveBeenCalled()
  })
})
