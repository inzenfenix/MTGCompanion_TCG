import type { Role } from '../../common/auth/permissions';

/** Internal row — AdminService masks the email before anything leaves the module. */
export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: Date;
}

/** One cell of the sales report before k-anonymity suppression (see domain/k-anonymity.ts). */
export interface SalesAggregateRow {
  month: string; // YYYY-MM — dates generalized to the month
  condition: string;
  paymentMethod: string;
  sales: number;
  total: number;
  distinctBuyers: number;
  distinctSellers: number;
}

export interface AdminRepository {
  listUsers(limit: number): Promise<AdminUserRow[]>;
  findUser(id: string): Promise<AdminUserRow | null>;
  setRole(id: string, role: Role): Promise<void>;
  /** Every user id — the "additional information" needed to undo a pseudonym. */
  allUserIds(): Promise<string[]>;
  paidSalesAggregates(): Promise<SalesAggregateRow[]>;
}

export const ADMIN_REPOSITORY = Symbol('ADMIN_REPOSITORY');
