import { Suspense } from "react";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInError, SignInWithGoogleButton } from "@/features/orgs/ui";

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Mycel</CardTitle>
          <CardDescription>Use your Google Workspace account.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Suspense>
            <ErrorFromQuery searchParams={searchParams} />
          </Suspense>
          <SignInWithGoogleButton />
        </CardContent>
      </Card>
    </main>
  );
}

// Better Auth sets `?error=<code>` when it turns a sign-in away.
const errorQuerySchema = z.object({ error: z.string().optional().catch(undefined) });

async function ErrorFromQuery({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const { error } = errorQuerySchema.parse(await searchParams);
  return error === undefined ? null : <SignInError code={error} />;
}
