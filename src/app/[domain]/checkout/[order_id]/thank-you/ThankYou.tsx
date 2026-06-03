"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatCents as formatCentsMoney } from "@/lib/money";

interface OrderLine {
  product_id: string;
  product_name?: string;
  quantity: number;
  unit_price?: number;
  subtotal?: number;
}

interface Order {
  id: string;
  order_number?: string;
  status?: string;
  payment_status?: string;
  total?: number;
  currency?: string;
  email?: string;
  items?: OrderLine[];
  shipping_address?: Record<string, unknown>;
}

function formatCents(cents?: number, currency = "EGP") {
  if (cents == null) return "";
  return formatCentsMoney(cents, currency);
}

export function ThankYou({
  orderId,
  orderNumberFromUrl,
}: {
  orderId: string;
  orderNumberFromUrl: string | null;
}) {
  const params = useParams() as { domain: string };
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/customer/orders/${orderId}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          // 404 here is plausible for guests whose session cookie
          // doesn't carry the order — show a graceful "saved your
          // order" message rather than an error.
          if (res.status === 404) {
            setError(
              orderNumberFromUrl
                ? `Your order ${orderNumberFromUrl} has been placed.`
                : "Your order has been placed.",
            );
            return;
          }
          setError(`Couldn't load your order (${res.status}).`);
          return;
        }
        const body = await res.json();
        setOrder((body?.data || body) as Order);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [orderId, orderNumberFromUrl]);

  return (
    <div className="space-y-6">
      <section className="bg-white p-6 rounded border text-center">
        <div className="text-3xl mb-2" aria-hidden>
          🎉
        </div>
        <h1 className="text-2xl font-semibold mb-1">Thank you!</h1>
        <p className="text-gray-700">
          Order{" "}
          <span className="font-mono">
            {order?.order_number || orderNumberFromUrl || `…${orderId.slice(-8)}`}
          </span>{" "}
          received. We'll email a confirmation shortly.
        </p>
      </section>

      {order && order.items && (
        <section className="bg-white p-6 rounded border">
          <h2 className="text-lg font-semibold mb-3">Items</h2>
          <ul className="divide-y">
            {order.items.map((l, i) => (
              <li key={i} className="py-2 flex justify-between text-sm">
                <span>
                  <span className="font-medium">
                    {l.product_name || `Item ${l.product_id.slice(0, 8)}`}
                  </span>
                  <span className="text-gray-500"> × {l.quantity}</span>
                </span>
                <span>{formatCents(l.subtotal, order.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between font-medium pt-3 border-t mt-3">
            <span>Total</span>
            <span>{formatCents(order.total, order.currency)}</span>
          </div>
        </section>
      )}

      {error && (
        <p
          role="status"
          className="text-center text-sm text-gray-700 bg-gray-50 border rounded p-3"
        >
          {error}
        </p>
      )}

      <div className="flex justify-center gap-4 text-sm">
        <Link
          href={`/${params.domain}/account/orders`}
          className="underline text-blue-700"
        >
          View your orders
        </Link>
        <Link href={`/${params.domain}`} className="underline text-blue-700">
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
