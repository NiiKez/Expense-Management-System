import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'

// Sidebar/Topbar reach into auth + notification queries; stub them so AppShell
// can be tested in isolation (we only care about the content region + boundary).
jest.mock('@/components/layout/Sidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="sidebar" />,
}))
jest.mock('@/components/layout/Topbar', () => ({
  __esModule: true,
  default: () => <div data-testid="topbar" />,
}))

import AppShell from '@/components/layout/AppShell'

function Boom(): React.ReactElement {
  throw new Error('boom')
}

function GoTo({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
  )
}

describe('AppShell', () => {
  it('renders the page content inside the main region, alongside the shell chrome', () => {
    render(
      <MemoryRouter>
        <AppShell title="Test">
          <p>page body</p>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByText('page body')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('topbar')).toBeInTheDocument()
  })

  it('isolates a page crash and recovers after navigating to another route', async () => {
    const user = userEvent.setup()
    // The boundary logs the caught error; silence the expected noise.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <MemoryRouter initialEntries={['/crash']}>
        <GoTo to="/ok" label="go-ok" />
        <Routes>
          <Route
            path="/crash"
            element={
              <AppShell>
                <Boom />
              </AppShell>
            }
          />
          <Route
            path="/ok"
            element={
              <AppShell>
                <p>recovered page</p>
              </AppShell>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    // The crashed page shows the recovery fallback, not a blank screen.
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Navigating to a healthy route resets the path-keyed boundary.
    await user.click(screen.getByText('go-ok'))

    expect(await screen.findByText('recovered page')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()

    errSpy.mockRestore()
  })
})
