import type { User } from '../types';
import { Role } from '../types';

export const STUB_USERS: User[] = [
  { id: 1, entra_id: '00000000-0000-0000-0000-000000000001', email: 'admin@contoso.com', display_name: 'Alice Admin', role: Role.ADMIN, manager_id: null, is_active: true, created_at: '', updated_at: '' },
  { id: 2, entra_id: '00000000-0000-0000-0000-000000000002', email: 'manager.bob@contoso.com', display_name: 'Bob Manager', role: Role.MANAGER, manager_id: 1, is_active: true, created_at: '', updated_at: '' },
  { id: 3, entra_id: '00000000-0000-0000-0000-000000000003', email: 'manager.carol@contoso.com', display_name: 'Carol Manager', role: Role.MANAGER, manager_id: 1, is_active: true, created_at: '', updated_at: '' },
  { id: 4, entra_id: '00000000-0000-0000-0000-000000000004', email: 'dave@contoso.com', display_name: 'Dave Employee', role: Role.EMPLOYEE, manager_id: 2, is_active: true, created_at: '', updated_at: '' },
  { id: 5, entra_id: '00000000-0000-0000-0000-000000000005', email: 'eve@contoso.com', display_name: 'Eve Employee', role: Role.EMPLOYEE, manager_id: 2, is_active: true, created_at: '', updated_at: '' },
  { id: 6, entra_id: '00000000-0000-0000-0000-000000000006', email: 'frank@contoso.com', display_name: 'Frank Employee', role: Role.EMPLOYEE, manager_id: 3, is_active: true, created_at: '', updated_at: '' },
  { id: 7, entra_id: '00000000-0000-0000-0000-000000000007', email: 'grace@contoso.com', display_name: 'Grace Employee', role: Role.EMPLOYEE, manager_id: 3, is_active: true, created_at: '', updated_at: '' },
];
