import { Suspense } from "react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UnsubscribeForm } from "@/features/notifications/ui";

// Where the digest email's signed unsubscribe link lands. No sign-in: the link vouches for the
// person, and the button confirms it.
export default function UnsubscribePage({ searchParams }: PageProps<"/unsubscribe">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>The daily review email</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense>
            <FormFromQuery searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

const tokenQuerySchema = z.object({ token: z.string().catch("") });

async function FormFromQuery({ searchParams }: Pick<PageProps<"/unsubscribe">, "searchParams">) {
  const { token } = tokenQuerySchema.parse(await searchParams);
  return <UnsubscribeForm token={token} />;
}
