import { DemoMessages } from "@/features/demo/ui";
import { DemoPage } from "../demo-page";

export default function DemoMessagesPage({ searchParams }: PageProps<"/demo/messages">) {
  return (
    <DemoPage title="Chat" adminOnly={false}>
      {(admin) => <Messages admin={admin} searchParams={searchParams} />}
    </DemoPage>
  );
}

// Reads the ?agent= link from the Agents screen inside the page's Suspense boundary.
async function Messages({
  admin,
  searchParams,
}: { admin: boolean } & Pick<PageProps<"/demo/messages">, "searchParams">) {
  const { agent } = await searchParams;
  return (
    <DemoMessages admin={admin} initialAgent={typeof agent === "string" ? agent : undefined} />
  );
}
