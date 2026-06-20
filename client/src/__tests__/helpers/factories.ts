import { Role, Status, Category } from '../../types';
import type { User, Expense, ApiResponse, PaginatedResponse } from '../../types';

export function mockUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    entra_id: 'oid-test-user',
    email: 'alice@example.com',
    display_name: 'Alice Example',
    role: Role.EMPLOYEE,
    manager_id: null,
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

export function mockExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 1,
    submitted_by: 1,
    title: 'Team Lunch',
    description: null,
    amount: 75.5,
    currency: 'USD',
    category: Category.MEALS,
    expense_date: '2024-03-15T00:00:00Z',
    status: Status.PENDING,
    approved_by: null,
    rejection_reason: null,
    version: 1,
    created_at: '2024-03-15T10:00:00Z',
    updated_at: '2024-03-15T10:00:00Z',
    ...overrides,
  };
}

export function mockApiResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function mockPaginatedResponse<T>(
  data: T[],
  pagination = { total: data.length, page: 1, pageSize: 20 }
): PaginatedResponse<T> {
  return { success: true, data, pagination };
}
