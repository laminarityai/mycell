import { handleDrivePush } from "@/features/discovery/server";

// Each Drive's changes.watch channel posts its notifications here (ADR-0026).
export async function POST(request: Request): Promise<Response> {
  const { status } = await handleDrivePush(request.headers);
  return new Response(null, { status });
}
