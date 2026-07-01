import { render, screen } from '@testing-library/react'
import type { OrgTreeNode, OrgUserDetail } from '@/types'

// Mock the data hook so the dialog renders standalone without the query/MSAL graph.
jest.mock('@/queries/org', () => ({ useOrgUser: jest.fn() }))

import { useOrgUser } from '@/queries/org'
import OrgNodeDetailDialog from '@/pages/org-chart/OrgNodeDetailDialog'

const mockedUseOrgUser = useOrgUser as jest.Mock

const node: OrgTreeNode = {
  id: 3,
  displayName: 'Jordan Lee',
  role: 'EMPLOYEE',
  jobTitle: 'Software Engineer',
  department: 'Engineering',
  managerId: 2,
  isActive: true,
}

const detail = (over: Partial<OrgUserDetail> = {}): OrgUserDetail => ({
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
  ...over,
})

function renderDialog(hook: Record<string, unknown>) {
  mockedUseOrgUser.mockReturnValue({ data: undefined, isPending: false, isError: false, ...hook })
  return render(
    <OrgNodeDetailDialog
      open
      onOpenChange={() => {}}
      node={node}
      managerName="Demo User"
      directReportCount={0}
    />,
  )
}

beforeEach(() => jest.clearAllMocks())

describe('OrgNodeDetailDialog', () => {
  it('shows the node name + a loading state while pending', () => {
    renderDialog({ isPending: true })
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument() // header is instant from the node
    expect(screen.getByText(/Loading details/i)).toBeInTheDocument()
  })

  it('renders contact fields, the manager and group badges when loaded', () => {
    renderDialog({ data: detail() })
    const mail = screen.getByRole('link', { name: 'jordan@corp.com' })
    expect(mail).toHaveAttribute('href', 'mailto:jordan@corp.com')
    expect(screen.getByText('San Francisco')).toBeInTheDocument()
    expect(screen.getByText('+1 555 0100')).toBeInTheDocument()
    expect(screen.getByText('E-0003')).toBeInTheDocument()
    expect(screen.getByText('Demo User')).toBeInTheDocument() // manager, from the tree
    expect(screen.getByText('Engineering', { selector: '*' })).toBeInTheDocument()
  })

  it('notes stored-records provenance when the source is local (demo/stub)', () => {
    renderDialog({ data: detail({ source: 'local', mobilePhone: null, groups: [] }) })
    expect(screen.getByText(/shown from stored records/i)).toBeInTheDocument()
    // No phone field row when there's no phone.
    expect(screen.queryByText('+1 555 0100')).not.toBeInTheDocument()
  })

  it('shows an error state when the fetch fails', () => {
    renderDialog({ isError: true })
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t load/i)
  })
})
