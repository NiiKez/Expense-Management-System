import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrgSearch from '@/pages/org-chart/OrgSearch'
import { indexOrgTree } from '@/pages/org-chart/tree'
import type { OrgTreeNode } from '@/types'

function person(id: number, displayName: string, extra: Partial<OrgTreeNode> = {}): OrgTreeNode {
  return {
    id,
    displayName,
    role: 'EMPLOYEE',
    jobTitle: null,
    department: null,
    managerId: id === 1 ? null : 1,
    isActive: true,
    ...extra,
  }
}

const index = indexOrgTree({
  scope: 'ADMIN',
  rootIds: [1],
  truncated: false,
  syncedAt: null,
  nodes: [
    person(1, 'Alice Admin', { jobTitle: 'Chief Administrator', department: 'Finance' }),
    person(2, 'Bob Manager', { jobTitle: 'Engineering Manager', department: 'Engineering' }),
    person(3, 'Dave Employee', { jobTitle: 'Software Engineer', department: 'Engineering' }),
  ],
})

function setup() {
  const onSelect = jest.fn()
  const user = userEvent.setup()
  render(<OrgSearch index={index} onSelect={onSelect} />)
  const input = screen.getByRole('combobox', { name: 'Find a person' })
  return { onSelect, user, input }
}

describe('OrgSearch', () => {
  it('stays closed until something is typed', async () => {
    const { user, input } = setup()
    await user.click(input)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists matches with their title and department', async () => {
    const { user, input } = setup()
    await user.type(input, 'engineer')
    const list = screen.getByRole('listbox')
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.querySelector('p')?.textContent)).toEqual(['Bob Manager', 'Dave Employee'])
    expect(within(list).getByText('Engineering Manager · Engineering')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  it('selects the clicked match and clears the box', async () => {
    const { user, input, onSelect } = setup()
    await user.type(input, 'dave')
    await user.click(screen.getByRole('option', { name: /Dave Employee/ }))
    expect(onSelect).toHaveBeenCalledWith(3)
    expect(input).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('moves the active option with the arrow keys (wrapping) and selects on Enter', async () => {
    const { user, input, onSelect } = setup()
    await user.type(input, 'engineer')
    const [bob, dave] = screen.getAllByRole('option')
    expect(bob).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(dave).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', dave!.id)

    await user.keyboard('{ArrowDown}')
    expect(bob).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}')
    expect(dave).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(3)
  })

  it('says so when no one matches, and Enter does nothing', async () => {
    const { user, input, onSelect } = setup()
    await user.type(input, 'zzz')
    expect(screen.getByText(/No one matches/)).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes on Escape and on blur', async () => {
    const { user, input } = setup()
    await user.type(input, 'bob')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.type(input, 'b')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.tab()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
