import { UserRole } from '@prisma/client';
export interface Actor {
  id: string;
  role: UserRole;
  businessId: string | null;
  driverId: string | null;
}
