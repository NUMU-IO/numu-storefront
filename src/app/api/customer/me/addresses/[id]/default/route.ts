import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * PUT /api/customer/me/addresses/[id]/default → set this address as
 * the customer's default. Backend flips the default flag atomically:
 * the previously-default address loses the flag in the same transaction.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyCustomer(req, {
    backendPath: `/storefront/me/addresses/${encodeURIComponent(id)}/default`,
    method: "PUT",
  });
}
