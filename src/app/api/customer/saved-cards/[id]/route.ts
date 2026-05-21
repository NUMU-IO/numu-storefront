/**
 * DELETE /api/customer/saved-cards/{id} → /storefront/me/saved-cards/{id}
 *
 * Soft-delete a saved card. Phase 7.5.
 */
import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyCustomer(req, {
    backendPath: `/storefront/me/saved-cards/${encodeURIComponent(id)}`,
    method: "DELETE",
  });
}
