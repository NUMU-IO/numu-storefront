import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8000/api/v1";

async function proxy(req: NextRequest, method: "POST" | "DELETE") {
  const body = method === "POST" ? await req.text() : undefined;
  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(`${API_URL}/storefront/cart/discount`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) (headers as Record<string, string>)["set-cookie"] = setCookie;
  return new NextResponse(text, { status: res.status, headers });
}

export async function POST(req: NextRequest) {
  return proxy(req, "POST");
}

export async function DELETE(req: NextRequest) {
  return proxy(req, "DELETE");
}
