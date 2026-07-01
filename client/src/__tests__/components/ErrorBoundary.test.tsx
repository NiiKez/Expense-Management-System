import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorBoundary, { AppErrorBoundary } from '@/components/common/ErrorBoundary'
import { renderWithProviders } from '../helpers/renderWithProviders'

// A child that throws while `shouldThrow` is set, then renders normally once it
// is cleared — lets us drive the boundary through catch → reset → recovery.
let shouldThrow = true
function Boom() {
  if (shouldThrow) throw new Error('kaboom')
  return <div>recovered</div>
}

describe('ErrorBoundary', () => {
  it('shows the default fallback on a render throw and recovers after Try again', async () => {
    // React logs caught render errors to console.error; silence it just for this
    // test so the expected noise doesn't pollute the run, then restore.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    shouldThrow = true

    // AppErrorBoundary wires the fallback's reset to QueryErrorResetBoundary's
    // reset, so it also needs the QueryClientProvider from renderWithProviders.
    renderWithProviders(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Stop throwing, then reset — the boundary re-renders its children and the
    // child now succeeds.
    shouldThrow = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('recovered')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()

    errSpy.mockRestore()
  })

  it('renders a custom fallback with the thrown error and calls onReset on reset', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    const onReset = jest.fn()
    shouldThrow = true

    render(
      <ErrorBoundary
        onReset={onReset}
        fallback={({ error, reset }) => (
          <div>
            <p>custom: {error.message}</p>
            <button type="button" onClick={reset}>
              reset-me
            </button>
          </div>
        )}
      >
        <Boom />
      </ErrorBoundary>,
    )

    // The fallback receives the actual Error instance.
    expect(screen.getByText('custom: kaboom')).toBeInTheDocument()

    shouldThrow = false
    await user.click(screen.getByRole('button', { name: 'reset-me' }))

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('recovered')).toBeInTheDocument()

    errSpy.mockRestore()
  })
})
