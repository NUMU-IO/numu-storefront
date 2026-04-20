const API_URL = process.env.NUMU_API_URL || "http://localhost:8000/api/v1";

interface FetchOptions extends RequestInit {
  tags?: string[];
  revalidate?: number;
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { tags, revalidate, ...fetchOptions } = options;
  const url = `${API_URL}${path}`;

  const res = await fetch(url, {
    ...fetchOptions,
    next: {
      tags: tags || [],
      revalidate: revalidate ?? 60,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export async function fetchStoreByDomain(domain: string) {
  return apiFetch<any>(`/storefront/store/resolve?domain=${encodeURIComponent(domain)}`, {
    tags: [`store-${domain}`],
    revalidate: 300,
  });
}

export async function fetchThemeSettings(storeId: string) {
  return apiFetch<any>(`/storefront/theme/${storeId}`, {
    tags: [`theme-${storeId}`],
    revalidate: 60,
  });
}

export async function fetchProducts(storeId: string, limit = 20) {
  return apiFetch<any>(`/storefront/${storeId}/products?limit=${limit}`, {
    tags: [`products-${storeId}`],
    revalidate: 60,
  });
}

export async function fetchProductBySlug(storeId: string, slug: string) {
  return apiFetch<any>(`/storefront/${storeId}/products/${slug}`, {
    tags: [`product-${storeId}-${slug}`],
    revalidate: 60,
  });
}

export async function fetchCollections(storeId: string) {
  return apiFetch<any>(`/storefront/${storeId}/collections`, {
    tags: [`collections-${storeId}`],
    revalidate: 120,
  });
}

export async function fetchCollectionBySlug(storeId: string, slug: string) {
  return apiFetch<any>(`/storefront/${storeId}/collections/${slug}`, {
    tags: [`collection-${storeId}-${slug}`],
    revalidate: 60,
  });
}
