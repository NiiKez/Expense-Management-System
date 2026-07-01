// `@/services/api` is auto-mocked; `@/services/auth` must be mocked too because
// auto-mock loads api.ts to read its export shape, and api.ts constructs MSAL at
// import — which throws in jsdom.
jest.mock('@/services/auth', () => ({
  msalInstance: { getActiveAccount: jest.fn(() => null), getAllAccounts: jest.fn(() => []) },
  msalReady: Promise.resolve(),
  loginRequest: { scopes: [] },
}))
jest.mock('@/services/api')

import api from '@/services/api'
import { downloadFile } from '@/lib/download'

const mockedApi = api as jest.Mocked<typeof api>

let createObjectURL: jest.Mock
let revokeObjectURL: jest.Mock
let clickSpy: jest.SpyInstance
let clickedAnchor: HTMLAnchorElement | null

beforeEach(() => {
  mockedApi.get.mockReset()
  createObjectURL = jest.fn(() => 'blob:mock-url')
  revokeObjectURL = jest.fn()
  // jsdom implements neither of these object-URL statics — install stubs so the
  // helper can create/revoke a URL without throwing.
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
  // jsdom's anchor.click() would attempt a real navigation (blob: URL) and log a
  // "Not implemented" warning. Stub it and capture the anchor at click time so we
  // can inspect the download attributes before the helper removes it from the DOM.
  clickedAnchor = null
  clickSpy = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {
      // downloadFile appends the anchor to the body before clicking and removes it
      // after — grab it here so we can inspect its download attributes.
      clickedAnchor = document.body.querySelector<HTMLAnchorElement>('a[download]')
    })
})

afterEach(() => {
  clickSpy.mockRestore()
})

describe('downloadFile', () => {
  it('GETs the path as a blob with the given params and downloads it', async () => {
    mockedApi.get.mockResolvedValue({
      data: 'a,b,c',
      headers: { 'content-type': 'application/vnd.ms-excel' },
    })

    await downloadFile('/expenses/export', { status: 'APPROVED', search: 'taxi' }, 'export.csv')

    // Must go through the authenticated axios instance as a blob, verbatim args.
    expect(mockedApi.get).toHaveBeenCalledWith('/expenses/export', {
      params: { status: 'APPROVED', search: 'taxi' },
      responseType: 'blob',
    })

    // The Blob's MIME type comes from the response header, not a hardcoded value.
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/vnd.ms-excel')

    expect(clickedAnchor?.download).toBe('export.csv')
    // Cleanup: the object URL is revoked and the anchor is detached again.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    expect(document.body.contains(clickedAnchor)).toBe(false)
  })

  it('falls back to text/csv when the response has no content-type header', async () => {
    mockedApi.get.mockResolvedValue({ data: 'x', headers: {} })

    await downloadFile('/p', {}, 'f.csv')

    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv')
  })

  it('falls back to text/csv when the content-type header is not a string', async () => {
    // axios can hand back array-valued headers; the helper only trusts strings.
    mockedApi.get.mockResolvedValue({ data: 'x', headers: { 'content-type': ['text/plain'] } })

    await downloadFile('/p', {}, 'f.csv')

    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv')
  })
})
