import { handleNangoWebhook } from "@/features/connections/server";

export async function POST(request: Request): Promise<Response> {
  const { status } = await handleNangoWebhook(await request.text(), request.headers);
  return new Response(null, { status });
}
