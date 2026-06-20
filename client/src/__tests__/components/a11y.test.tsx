import React from 'react'
import { render, screen } from '@testing-library/react'
import SortableHeader from '@/components/common/SortableHeader'
import FileDropzone from '@/components/expenses/FileDropzone'
import { Table, TableHeader, TableRow } from '@/components/ui/table'
import type { SortState } from '@/lib/sort'

function renderHeader(sort: SortState) {
  return render(
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader label="Title" sortKey="title" sort={sort} onSort={() => {}} />
        </TableRow>
      </TableHeader>
    </Table>,
  )
}

describe('SortableHeader accessibility', () => {
  it('describes the sort action when the column is inactive', () => {
    renderHeader({ key: null, order: 'desc' })
    expect(screen.getByRole('button', { name: 'Sort by Title' })).toBeInTheDocument()
  })

  it('announces the current sort direction when the column is active', () => {
    renderHeader({ key: 'title', order: 'asc' })
    expect(
      screen.getByRole('button', { name: 'Sort by Title, currently ascending' }),
    ).toBeInTheDocument()
  })
})

describe('FileDropzone accessibility', () => {
  it('gives the focusable dropzone an accessible name', () => {
    render(<FileDropzone onFile={() => {}} />)
    const dropzone = screen.getByRole('button', { name: /receipt/i })
    expect(dropzone).toHaveAttribute('tabindex', '0')
  })
})
