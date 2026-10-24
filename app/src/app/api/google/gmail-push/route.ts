import { handleGmailPush } from "@/features/discovery/server";

// Pub/Sub's push subscription posts each Gmail notification here (ADR-0026).
export async function POST(request: Request): Promise<Response> {
  const { status } = await handleGmailPush(await request.text(), request.headers);
  return new Response(null, { status });
}
