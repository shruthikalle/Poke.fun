import { NextRequest, NextResponse } from "next/server";
import { enterPaidQueue } from "../../../lib/sol/paidQueue";
import { sessionAddress } from "../../../lib/wallet/serverSessions";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const address = sessionAddress(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null);
  if (!address) return NextResponse.json({ error: "Sign in with Phantom to wager Devnet SOL" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await enterPaidQueue(address, body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
