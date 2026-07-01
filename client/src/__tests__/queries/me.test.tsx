import { renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '../helpers/renderWithProviders'
import type { User, MeStats, UserPreferences, MyDirectory } from '../../types'
import { Role } from '../../types'

// Prevent PublicClientApplication construction (needs Web Crypto, absent in jsdom).
jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
jest.mock('@/services/api')
import api from '@/services/api'
import { useMe, useMeStats, useMyDirectory, useUpdatePreferences, meKeys } from '@/queries/me'

const mockedApi = api as jest.Mocked<typeof api>

const user: User = {
  id: 1,
  entra_id: 'oid-1',
  email: 'a@b.com',
  display_name: 'Alice',
  role: Role.EMPLOYEE,
  manager_id: null,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const stats: MeStats = {
  totals: { submitted: 3, pending: 1, approved: 1, rejected: 1 },
  approvedAmountMonth: 100,
  baseCurrency: 'USD',
  byCategory: [],
  monthly: [],
}

beforeEach(() => jest.clearAllMocks())

describe('useMe', () => {
  it('GETs /me and returns the unwrapped user', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: user } })
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useMe(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/me')
    expect(result.current.data).toEqual(user)
  })

  it('does not fetch when disabled', () => {
    const { wrapper } = createQueryWrapper()
    renderHook(() => useMe({ enabled: false }), { wrapper })
    expect(mockedApi.get).not.toHaveBeenCalled()
  })
})

describe('useMeStats', () => {
  it('GETs /me/stats and returns the unwrapped stats', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: stats } })
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useMeStats(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/me/stats')
    expect(result.current.data).toEqual(stats)
  })
})

describe('useMyDirectory', () => {
  it('GETs /me/directory and returns the unwrapped directory', async () => {
    const directory: MyDirectory = {
      orgAttributes: { department: 'Eng', jobTitle: 'SWE', employeeId: 'E-1', officeLocation: 'SF' },
      managerChain: [{ id: 'oid-9', displayName: 'Boss', jobTitle: 'Director', department: 'Eng' }],
      groups: [{ id: 'g1', name: 'Engineering' }],
    }
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: directory } })
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useMyDirectory(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.get).toHaveBeenCalledWith('/me/directory')
    expect(result.current.data).toEqual(directory)
  })

  it('does not fetch when disabled', () => {
    const { wrapper } = createQueryWrapper()
    renderHook(() => useMyDirectory({ enabled: false }), { wrapper })
    expect(mockedApi.get).not.toHaveBeenCalled()
  })
})

describe('useUpdatePreferences', () => {
  it('PATCHes /me/preferences and invalidates the me query', async () => {
    const prefs: UserPreferences = {
      default_currency: 'EUR',
      notify_on_submission: true,
      notify_on_decision: false,
      notify_on_comment: true,
    }
    mockedApi.patch.mockResolvedValueOnce({ data: { success: true, data: prefs } })
    const { client, wrapper } = createQueryWrapper()
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useUpdatePreferences(), { wrapper })
    result.current.mutate(prefs)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedApi.patch).toHaveBeenCalledWith('/me/preferences', prefs)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: meKeys.me })
    expect(result.current.data).toEqual(prefs)
  })
})
