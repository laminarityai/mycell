"use client";

import { createAuthClient } from "better-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const authClient = createAuthClient();

export function SignInWithGoogleButton() {
  const [pending, setPending] = useState(false);
  return (
    <Button
      disabled={pending}
      onClick={() => {
        setPending(true);
        // Better Auth sends rejections back to /sign-in with an `?error=` code.
        void authClient.signIn.social({
          provider: "google",
          callbackURL: "/",
          errorCallbackURL: "/sign-in",
        });
      }}
    >
      Sign in with Google
    </Button>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={() => {
        void authClient.signOut().then(() => {
          router.push("/sign-in");
        });
      }}
    >
      Sign out
    </Button>
  );
}
