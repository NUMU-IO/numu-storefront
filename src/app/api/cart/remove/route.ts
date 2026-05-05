import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8000/api/v1";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(`${API_URL}/storefront/cart/remove`, {
    method: "POST",
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
