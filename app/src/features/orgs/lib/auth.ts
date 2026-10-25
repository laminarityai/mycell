// Better Auth: Google sign-in only, with the organization plugin's tables as the org model
// (ADR-0002). Orgs and memberships change only through this feature's server functions, so
// the plugin's own HTTP endpoints are switched off.
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";
import * as authSchema from "@/db/auth-schema";
import { getDb } from "@/db/client";
import { env } from "@/env";
import { RemovedFromOrgError, WorkspaceAccountRequiredError } from "@/lib/errors";
import { signIn } from "./sign-in";
import { verifiedGoogleProfile } from "./verified-google-profile";

const workspaceAccountRequired = {
  error: WorkspaceAccountRequiredError.code,
  errorDescription: new WorkspaceAccountRequiredError().message,
};

function createAuth() {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    },
    user: {
      // Turns a personal Google account away before Better Auth stores a user row for it.
      // `profile` holds the claims of the ID token Google just issued, so `hd` is verified.
      validateUserInfo: ({ source }) =>
        source.oauth?.providerId === "google" && typeof source.oauth.profile?.hd !== "string"
          ? workspaceAccountRequired
          : undefined,
    },
    databaseHooks: {
      session: {
        create: {
          // Every sign-in passes through here: join or create the org before the session exists.
          before: async (session) => {
            try {
              await signIn(await verifiedGoogleProfile(session.userId));
            } catch (error) {
              // This hook is the sign-in route's error boundary: Better Auth redirects to the
              // sign-in page with the code as `?error=`.
              if (error instanceof WorkspaceAccountRequiredError) {
                throw new APIError("FORBIDDEN", {
                  code: workspaceAccountRequired.error,
                  message: workspaceAccountRequired.errorDescription,
                });
              }
              if (error instanceof RemovedFromOrgError) {
                throw new APIError("FORBIDDEN", {
                  code: RemovedFromOrgError.code,
                  message: error.message,
                });
              }
              throw error;
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware((ctx) => {
        if (ctx.path.startsWith("/organization/")) throw new APIError("NOT_FOUND");
        return Promise.resolve();
      }),
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        schema: {
          organization: {
            additionalFields: {
              workspaceDomain: { type: "string", required: true, input: false },
            },
          },
        },
      }),
    ],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

/** Created on first use, so importing this feature doesn't need a database or Google client. */
export function getAuth(): ReturnType<typeof createAuth> {
  auth ??= createAuth();
  return auth;
}
