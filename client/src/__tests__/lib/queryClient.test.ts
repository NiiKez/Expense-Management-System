import { createQueryClient, queryClient } from '@/lib/queryClient'

// These defaults are the money-path guardrails: a mutation that retries could
// double-submit an expense or double-approve a request on a failed write, and
// the query staleTime/gcTime/focus policy is what keeps this back-office app off
// the network on every tab focus. Pin them so a config drift is caught here.
describe('createQueryClient defaults', () => {
  it('never retries mutations (no silent re-run of a write)', () => {
    const defaults = createQueryClient().getDefaultOptions()
    expect(defaults.mutations?.retry).toBe(0)
  })

  it('sets the app-wide query defaults', () => {
    const { queries } = createQueryClient().getDefaultOptions()
    expect(queries?.retry).toBe(1)
    expect(queries?.staleTime).toBe(30_000)
    expect(queries?.gcTime).toBe(300_000)
    expect(queries?.refetchOnWindowFocus).toBe(false)
  })

  it('builds a fresh client each call (not the shared singleton)', () => {
    // Callers/tests must be able to build an isolated client without mutating
    // the app-wide one.
    expect(createQueryClient()).not.toBe(createQueryClient())
  })

  it('exports a singleton carrying the same defaults', () => {
    const defaults = queryClient.getDefaultOptions()
    expect(defaults.mutations?.retry).toBe(0)
    expect(defaults.queries?.retry).toBe(1)
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false)
  })
})
