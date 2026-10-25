// The events runtime's Calendar poll sends from inside its own step, which Inngest retries: the
// invites a listing found, read in the step before, so a retried step sends the same again.
import { inngest } from "@/lib/inngest";
import { calendarInviteReceived, type CalendarInviteReceived } from "../events";

/** Sends one event per invite. The event ID makes an invite sent again start nothing new. */
export async function sendInvitesReceived(invites: CalendarInviteReceived[]): Promise<void> {
  if (invites.length === 0) return;
  await inngest.send(
    invites.map((data) =>
      calendarInviteReceived.create(data, {
        id: `calendar-invite-${data.connectionId}-${data.sourceRef}`,
      }),
    ),
  );
}
