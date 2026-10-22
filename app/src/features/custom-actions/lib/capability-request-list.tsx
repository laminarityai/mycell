// The capability requests page's list: each request the builder chat filed for the org, how
// often it was asked, where it stands with our team, and the conversations that asked.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CapabilityRequest, CapabilityRequestField, CapabilityRequestStatus } from "../types";

const STATUS_LABELS: Record<CapabilityRequestStatus, string> = {
  open: "Open",
  building: "Building",
  shipped: "Shipped",
  declined: "Declined",
};

export function CapabilityRequestList({
  requests,
  conversationTitles,
}: {
  requests: CapabilityRequest[];
  /** The org's builder conversations' titles, by ID. */
  conversationTitles: Record<string, string | null>;
}) {
  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No capability requests yet. When the builder chat can&apos;t do something you describe, it
        asks Mycel&apos;s team, and the request appears here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4" aria-label="Capability requests">
      {requests.map((request) => (
        <li key={request.id}>
          <RequestCard request={request} conversationTitles={conversationTitles} />
        </li>
      ))}
    </ul>
  );
}

function RequestCard({
  request,
  conversationTitles,
}: {
  request: CapabilityRequest;
  conversationTitles: Record<string, string | null>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{request.operation}</span>
          <Badge variant={request.status === "shipped" ? "default" : "outline"}>
            {STATUS_LABELS[request.status]}
          </Badge>
        </CardTitle>
        <CardDescription>
          {request.app.name}
          {request.app.id === null ? ", which Mycel doesn't work with yet" : ""} · Asked{" "}
          {request.count === 1 ? "once" : `${String(request.count)} times`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {request.note === null ? null : (
          <p>
            <span className="font-medium">Note from Mycel&apos;s team:</span> {request.note}
          </p>
        )}
        <p>{request.reason}</p>
        <Fields title="Inputs" fields={request.inputs} />
        <Fields title="Outputs" fields={request.outputs} />
        {request.codeDraft === null ? null : (
          <details>
            <summary className="cursor-pointer font-medium">Code draft</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs">
              {request.codeDraft}
            </pre>
          </details>
        )}
        <div>
          <p className="font-medium">Asked in</p>
          <ul className="list-inside list-disc">
            {request.conversationIds.map((id) => (
              <li key={id}>
                <Link href={`/builder/${id}`} className="underline">
                  {conversationTitles[id] ?? "Untitled conversation"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function Fields({ title, fields }: { title: string; fields: CapabilityRequestField[] }) {
  if (fields.length === 0) return null;
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="list-inside list-disc">
        {fields.map((field, index) => (
          <li key={index}>
            <span className="font-mono text-xs">{field.name}</span>: {field.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
