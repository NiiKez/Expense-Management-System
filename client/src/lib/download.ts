import api from '@/services/api'

/**
 * Fetch a file from an authenticated API endpoint as a blob and trigger a
 * browser download. Goes through the axios instance so the auth header (bearer
 * or stub) is attached — a plain anchor href would not be authenticated.
 */
export async function downloadFile(
  path: string,
  params: Record<string, string>,
  filename: string,
): Promise<void> {
  const res = await api.get(path, { params, responseType: 'blob' })
  const contentType = res.headers['content-type']
  const blob = new Blob([res.data], {
    type: typeof contentType === 'string' ? contentType : 'text/csv',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
