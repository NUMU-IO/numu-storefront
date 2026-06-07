/**
 * /[domain]/pay/[orderId] — COD-recovery payment page.
 *
 * The landing page for the `cod_recovery_offer_v1` WhatsApp button: a buyer
 * who placed a high-risk COD order is nudged to pay online (converting the
 * order COD → prepaid). force-dynamic — the order's payable state must be
 * read fresh, never ISR-cached.
 *
 * Backend contract: docs/whatsapp-templates/cod-recovery-offer-spec.md §5
 * (NUMU-api). The page itself is platform UX (not theme-forked) — recovery
 * is a network feature, identical across themes.
 */

import { PayRecovery } from "./PayRecovery";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string; orderId: string }>;
}

export default async function PayPage({ params }: PageProps) {
  const { orderId } = await params;
  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <PayRecovery orderId={orderId} />
    </div>
  );
}
