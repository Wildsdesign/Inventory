/**
 * Vendors API client (list-only for the items edit dialog dropdown).
 * VendorsPage.tsx owns the full CRUD surface.
 */

import { apiRequest } from './api';

export interface Vendor {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VendorsListResponse {
  vendors: Vendor[];
}

export const vendorsApi = {
  list: () => apiRequest<VendorsListResponse>('GET', '/v1/vendors'),
};
