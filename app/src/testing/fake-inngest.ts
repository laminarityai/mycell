// The fake Inngest: Inngest Cloud's event API behind msw's fetch interception, so code that
// sends events runs the real Inngest client without network or keys. It records the events and
// runs nothing: tests call the server function a job would call.
import { http, HttpResponse } from "msw";
import { env } from "@/env";

/** An event as the Inngest client sends it. */
export type FakeInngestEvent = { name: string; id?: string; data: Record<string, unknown> };

class FakeInngest {
  private events: FakeInngestEvent[] = [];
  private failing = false;

  reset(): void {
    this.events = [];
    this.failing = false;
  }

  /** Makes the event API answer 500, until `failSends(false)` or the next reset. */
  failSends(failing = true): void {
    this.failing = failing;
  }

  /** The events sent so far, oldest first, optionally only those with the given name. */
  sent(name?: string): FakeInngestEvent[] {
    return this.events.filter((event) => name === undefined || event.name === name);
  }

  readonly handlers = [
    http.post("https://inn.gs/e/:eventKey", async ({ request, params }) => {
      if (params.eventKey !== env.INNGEST_EVENT_KEY) {
        return HttpResponse.json({ error: "Event key not found", status: 401 }, { status: 401 });
      }
      if (this.failing) {
        return HttpResponse.json({ error: "Internal error", status: 500 }, { status: 500 });
      }
      const body = (await request.json()) as FakeInngestEvent | FakeInngestEvent[];
      const events = Array.isArray(body) ? body : [body];
      this.events.push(...events);
      return HttpResponse.json({ ids: events.map((_, i) => `event-${String(i)}`), status: 200 });
    }),
  ];
}

export const fakeInngest = new FakeInngest();
