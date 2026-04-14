/**
 * Storage Locations API client.
 *
 * Unified adapter matching Recipe/StockSense so both apps share the same
 * Storage Locations page shape — CRUD + walk-order reorder + setup wizard
 * (bulk create from a standard hospital-kitchen template catalog).
 */

import { apiRequest } from './api';

export interface StorageLocation {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StorageLocationsListResponse {
  locations: StorageLocation[];
  count: number;
}

export interface StorageLocationInput {
  name: string;
  description?: string | null;
  category?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface TemplateLocation {
  name: string;
  description: string;
  category: string;
  alreadyExists: boolean;
}

export interface TemplateCategory {
  category: string;
  label: string;
  locations: TemplateLocation[];
}

export interface TemplatesResponse {
  categories: TemplateCategory[];
  totalTemplates: number;
  existingCount: number;
}

export const storageLocationsApi = {
  list: () =>
    apiRequest<StorageLocationsListResponse>('GET', '/v1/storage-locations'),

  templates: () =>
    apiRequest<TemplatesResponse>('GET', '/v1/storage-locations/templates'),

  setup: (names: string[]) =>
    apiRequest<{ success: boolean; created: number }>(
      'POST',
      '/v1/storage-locations/setup',
      { names },
    ),

  create: (data: StorageLocationInput) =>
    apiRequest<{ id: string; success: boolean }>('POST', '/v1/storage-locations', data),

  update: (id: string, data: Partial<StorageLocationInput>) =>
    apiRequest<StorageLocation>('PUT', `/v1/storage-locations/${id}`, data),

  delete: (id: string) =>
    apiRequest<{ success: boolean }>('DELETE', `/v1/storage-locations/${id}`),

  reorder: (order: Array<{ id: string; sortOrder: number }>) =>
    apiRequest<{ success: boolean; count: number }>(
      'POST',
      '/v1/storage-locations/reorder',
      { order },
    ),
};
