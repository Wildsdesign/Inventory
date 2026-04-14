/**
 * Items / allergens / USDA API client for Inventory.
 *
 * Sibling to Recipe's items-api — shapes match so UI components can be
 * shared. Backend response shapes are adapted here where they differ.
 */

import { apiRequest } from './api';

// ── Types ────────────────────────────────────────────────────────────

export interface ItemNutrition {
  servingSize: number | null;
  servingUnit: string | null;
  calories: number | null;
  protein: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  transFat: number | null;
  carbohydrate: number | null;
  fiber: number | null;
  sugar: number | null;
  addedSugar: number | null;
  cholesterol: number | null;
  sodium: number | null;
  potassium: number | null;
  calcium: number | null;
  iron: number | null;
  phosphorus: number | null;
  vitaminD: number | null;
  rawNutrients: Record<string, { value: number; unit: string; nutrientId?: number }> | null;
  ingredients: string | null;
  source: string | null;
  usdaFdcId: string | null;
  lastEnrichedAt: string | null;
}

export interface ItemAllergen {
  id: string;
  allergenId: string;
  allergenName: string;
  isBigNine: boolean;
  category: string;
  severity: 'CONTAINS' | 'MAY_CONTAIN';
  source: 'USDA_VERIFIED' | 'AI_SUGGESTED' | 'MANUAL' | 'ROLLUP';
}

export interface ItemVendorRef {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorSku: string | null;
  vendorItemName: string | null;
  packSize: string | null;
  lastCost: number | null;
  lastReceivedAt: string | null;
}

export interface Item {
  id: string;
  facilityId: string;
  name: string;
  healthTouchItemId: string | null;
  isRecipe: boolean;
  category: string | null;
  portionSize: number | null;
  portionUnit: string | null;
  itemCost: number | null;
  currentQty: number;
  reorderPoint: number | null;
  reorderQty: number | null;
  isLowStock: boolean;
  storageLocationId: string | null;
  storageLocationName: string | null;
  syncedAt: string;
  pushedAt: string | null;
  createdAt: string;
  updatedAt: string;
  nutrition: ItemNutrition | null;
  allergens: ItemAllergen[];
  vendors: ItemVendorRef[];
}

export interface Allergen {
  id: string;
  name: string;
  isBigNine: boolean;
  category: string;
}

export interface ItemsListResponse {
  items: Item[];
  count: number;
}

export interface AllergensListResponse {
  allergens: Allergen[];
  count: number;
}

// ── Items API ────────────────────────────────────────────────────────

export const itemsApi = {
  list: (params?: {
    search?: string;
    category?: string;
    hasNutrition?: boolean;
    hasAllergens?: boolean;
  }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.category) query.set('category', params.category);
    if (params?.hasNutrition !== undefined) query.set('hasNutrition', String(params.hasNutrition));
    if (params?.hasAllergens !== undefined) query.set('hasAllergens', String(params.hasAllergens));
    const qs = query.toString();
    return apiRequest<ItemsListResponse>('GET', `/v1/items${qs ? '?' + qs : ''}`);
  },

  get: (id: string) => apiRequest<Item>('GET', `/v1/items/${id}`),

  create: (data: Record<string, unknown>) =>
    apiRequest<Item>('POST', '/v1/items', data),

  update: (id: string, data: Record<string, unknown>) =>
    apiRequest<Item>('PUT', `/v1/items/${id}`, data),

  delete: (id: string) =>
    apiRequest<{ success: boolean }>('DELETE', `/v1/items/${id}`),
};

// ── Allergens API ────────────────────────────────────────────────────

export interface AiAllergenResult {
  applied: number;
  allergens: ItemAllergen[];
}

export const allergensApi = {
  list: () => apiRequest<AllergensListResponse>('GET', '/v1/allergens'),

  detectAI: (itemId: string) =>
    apiRequest<AiAllergenResult>('POST', `/v1/items/${itemId}/ai-allergens`, {}),
};

// ── USDA API ─────────────────────────────────────────────────────────

export interface USDANutrientPreview {
  calories?: number;
  protein?: number;
  totalFat?: number;
  saturatedFat?: number;
  transFat?: number;
  carbohydrate?: number;
  fiber?: number;
  sugar?: number;
  addedSugar?: number;
  cholesterol?: number;
  sodium?: number;
  potassium?: number;
  calcium?: number;
  iron?: number;
  phosphorus?: number;
  magnesium?: number;
  zinc?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number;
}

export interface USDASearchResult {
  fdcId: number;
  description: string;
  brandOwner?: string;
  brandName?: string;
  dataType: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  ingredients?: string;
  nutrientPreview?: USDANutrientPreview;
}

export interface USDADetail extends USDASearchResult {
  mapped: USDANutrientPreview;
  rawNutrients: Record<string, { value: number; unit: string; nutrientId: number }>;
}

export const usdaApi = {
  search: (query: string) =>
    apiRequest<{ results: USDASearchResult[]; count: number }>(
      'GET',
      `/v1/usda/search?q=${encodeURIComponent(query)}`,
    ),

  detail: (fdcId: number) => apiRequest<USDADetail>('GET', `/v1/usda/${fdcId}`),

  apply: (itemId: string, fdcId: number, overwrite: boolean) =>
    apiRequest<unknown>('POST', `/v1/items/${itemId}/apply-usda`, {
      fdcId,
      overwrite,
    }),
};
