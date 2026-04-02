import { getVapidPublicKey } from "@/lib/web-push-env";
import { NextResponse } from "next/server";

export async function GET() {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ error: "VAPID public key not configured" }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
