import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.REVALIDATION_SECRET || "";

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.secret !== SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  const tags: string[] = body.tags || [];
  const storeId = body.store_id;

  if (storeId) {
    tags.push(`store-${storeId}`, `theme-${storeId}`);
  }

  const revalidated: string[] = [];
  for (const tag of [...new Set(tags)]) {
    try {
      revalidateTag(tag, "default");
      revalidated.push(tag);
    } catch (e) {
      console.warn(`Failed to revalidate tag: ${tag}`, e);
    }
  }

  return NextResponse.json({ revalidated, success: true });
}
