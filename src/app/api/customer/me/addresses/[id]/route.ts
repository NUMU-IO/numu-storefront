import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * GET    /api/customer/me/addresses/[id]
 * PUT    /api/customer/me/addresses/[id]
 * DELETE /api/customer/me/addresses/[id]
 *
 * Single-address CRUD. The backend validates ownership via cookie
 * before serving / mutating. Idempotent DELETE: returns 204 even if
 * address doesn't exist (so retries don't 404 unexpectedly).
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyCustomer(req, {
    backendPath: `/storefront/me/addresses/${encodeURIComponent(id)}`,
    method: "GET",
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyCustomer(req, {
    backendPath: `/storefront/me/addresses/${encodeURIComponent(id)}`,
    method: "PUT",
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyCustomer(req, {
    backendPath: `/storefront/me/addresses/${encodeURIComponent(id)}`,
    method: "DELETE",
  });
}
