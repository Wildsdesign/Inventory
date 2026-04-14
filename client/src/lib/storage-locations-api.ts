/**
 * Storage Locations API client (list-only for now; CRUD lives on StorageLocationsPage).
 */

import { apiRequest } from './api';

export interface StorageLocation {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface StorageLocationsListResponse {
  storageLocations: StorageLocation[];
}

// Normalized shape used by the items edit dialog — matches Recipe's naming
// (`locations`) so the dropdown component reads identically.
export interface NormalizedStorageLocations {
  locations: StorageLocation[];
}

export const storageLocationsApi = {
  list: async (): Promise<NormalizedStorageLocations> => {
    const raw = await apiRequest<StorageLocationsListResponse>('GET', '/v1/storage-locations');
    return { locations: raw.storageLocations };
  },
};
