export type UserRole = 'super_admin' | 'admin' | 'user';

export const canAccessDashboard = (role: UserRole): boolean =>
  role === 'super_admin' || role === 'admin';
