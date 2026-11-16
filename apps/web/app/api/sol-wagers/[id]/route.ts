import { NextRequest, NextResponse } from "next/server";
import { cancelPaid, confirmCancel, confirmJoin, confirmOpen, getPaidTicket, paidStatus } from "../../../../lib/sol/paidQueue";
import { sessionAddress } from "../../../../lib/wallet/serverSessions";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function ticket(request: NextRequest, id: string) {
  const address = sessionAddress(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null);
  if (!address) throw new Error("Phantom sign-in expired. Sign in again.");
  return getPaidTicket(id, request.headers.get("x-queue-token") ?? "", address);
}

function failure(error: unknown) {
  return NextResponse.json({ error: (error as Error).message }, { status: 400 });
}

export async function GET(request: NextRequest, context: Context) {
  try { return NextResponse.json(paidStatus(ticket(request, (await context.params).id))); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const entry = ticket(request, (await context.params).id);
    const body = await request.json() as { action: string; wager?: string; signature?: string };
    if (body.action === "open" && body.wager && body.signature) return NextResponse.json(await confirmOpen(entry, body.wager, body.signature));
    if (body.action === "join" && body.signature) return NextResponse.json(await confirmJoin(entry, body.signature));
    if (body.action === "cancel_onchain") return NextResponse.json(await confirmCancel(entry));
    return NextResponse.json({ error: "Invalid wager action" }, { status: 400 });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest, context: Context) {
  try { return NextResponse.json(await cancelPaid(ticket(request, (await context.params).id))); }
  catch (error) { return failure(error); }
}
