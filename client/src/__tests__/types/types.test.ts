import { Role, Status, Category, AuditAction } from '../../types';

// ── Role ─────────────────────────────────────────────────────────

describe('Role', () => {
  it('should have the correct values', () => {
    expect(Role.EMPLOYEE).toBe('EMPLOYEE');
    expect(Role.MANAGER).toBe('MANAGER');
    expect(Role.ADMIN).toBe('ADMIN');
  });

  it('should have exactly 3 members', () => {
    expect(Object.keys(Role)).toHaveLength(3);
  });

  it('should cover all expected roles exhaustively', () => {
    const expected = ['EMPLOYEE', 'MANAGER', 'ADMIN'];
    expect(Object.values(Role).sort()).toEqual(expected.sort());
  });
});

// ── Status ───────────────────────────────────────────────────────

describe('Status', () => {
  it('should have the correct values', () => {
    expect(Status.PENDING).toBe('PENDING');
    expect(Status.APPROVED).toBe('APPROVED');
    expect(Status.REJECTED).toBe('REJECTED');
  });

  it('should have exactly 3 members', () => {
    expect(Object.keys(Status)).toHaveLength(3);
  });

  it('should cover all expected statuses exhaustively', () => {
    const expected = ['PENDING', 'APPROVED', 'REJECTED'];
    expect(Object.values(Status).sort()).toEqual(expected.sort());
  });
});

// ── Category ─────────────────────────────────────────────────────

describe('Category', () => {
  it('should have the correct values', () => {
    expect(Category.TRAVEL).toBe('TRAVEL');
    expect(Category.MEALS).toBe('MEALS');
    expect(Category.SUPPLIES).toBe('SUPPLIES');
    expect(Category.EQUIPMENT).toBe('EQUIPMENT');
    expect(Category.SOFTWARE).toBe('SOFTWARE');
    expect(Category.TRAINING).toBe('TRAINING');
    expect(Category.OTHER).toBe('OTHER');
  });

  it('should have exactly 7 members', () => {
    expect(Object.keys(Category)).toHaveLength(7);
  });

  it('should cover all expected categories exhaustively', () => {
    const expected = ['TRAVEL', 'MEALS', 'SUPPLIES', 'EQUIPMENT', 'SOFTWARE', 'TRAINING', 'OTHER'];
    expect(Object.values(Category).sort()).toEqual(expected.sort());
  });
});

// ── AuditAction ──────────────────────────────────────────────────

describe('AuditAction', () => {
  it('should have the correct values', () => {
    expect(AuditAction.SUBMITTED).toBe('SUBMITTED');
    expect(AuditAction.RESUBMITTED).toBe('RESUBMITTED');
    expect(AuditAction.APPROVED).toBe('APPROVED');
    expect(AuditAction.REJECTED).toBe('REJECTED');
    expect(AuditAction.OVERRIDDEN).toBe('OVERRIDDEN');
    expect(AuditAction.UPDATED).toBe('UPDATED');
    expect(AuditAction.DELETED).toBe('DELETED');
  });

  it('should have exactly 7 members', () => {
    expect(Object.keys(AuditAction)).toHaveLength(7);
  });

  it('should cover all expected actions exhaustively', () => {
    const expected = ['SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'OVERRIDDEN', 'UPDATED', 'DELETED'];
    expect(Object.values(AuditAction).sort()).toEqual(expected.sort());
  });
});

// ── All enums produce string values ──────────────────────────────

describe('enum value types', () => {
  it.each([
    ['Role', Role],
    ['Status', Status],
    ['Category', Category],
    ['AuditAction', AuditAction],
  ] as const)('%s values are all strings', (_name, enumObj) => {
    for (const value of Object.values(enumObj)) {
      expect(typeof value).toBe('string');
    }
  });

  it.each([
    ['Role', Role],
    ['Status', Status],
    ['Category', Category],
    ['AuditAction', AuditAction],
  ] as const)('%s keys match their values', (_name, enumObj) => {
    for (const [key, value] of Object.entries(enumObj)) {
      expect(key).toBe(value);
    }
  });
});
