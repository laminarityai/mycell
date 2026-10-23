// The fake Google push: Pub/Sub's authenticated push, as a Gmail notification reaches Mycel.
// Google signs each push's token with a key from its published key set, which the fake serves
// through msw at Google's key-set URL with a test key in place of Google's. A test posts a
// notification to the route the way the push subscription would, with a token it can spoil
// (another audience, another sender, another key, none at all).
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { http, HttpResponse } from "msw";
import { env } from "@/env";

const KEY_SET_URL = "https://www.googleapis.com/oauth2/v3/certs";
const KEY_ID = "fake-google-push-key";
const SUBSCRIPTION = "projects/mycel-test/subscriptions/gmail-push";

type KeyPair = { publicKey: CryptoKey; privateKey: CryptoKey };

/** What a test may change about a push's token; each defaults to what Google would send. */
export type PushTokenClaims = {
  issuer?: string;
  audience?: string;
  email?: string;
  emailVerified?: boolean;
  // Signed with a key Google's key set doesn't hold, under the same key ID: a forgery.
  forged?: boolean;
  expired?: boolean;
};

class FakeGooglePush {
  private google: Promise<KeyPair> | undefined;
  private forger: Promise<KeyPair> | undefined;
  private messages = 0;

  /** A push's token, signed as Google signs it unless `claims` spoil it. */
  async token(claims: PushTokenClaims = {}): Promise<string> {
    const { privateKey } = await (claims.forged === true ? this.forgerKeys() : this.googleKeys());
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = claims.expired === true ? now - 7200 : now;
    return new SignJWT({
      email: claims.email ?? env.GOOGLE_PUSH_SERVICE_ACCOUNT,
      email_verified: claims.emailVerified ?? true,
      sub: "112233445566778899000",
      azp: "112233445566778899000",
    })
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
      .setIssuer(claims.issuer ?? "https://accounts.google.com")
      .setAudience(claims.audience ?? env.GOOGLE_PUSH_AUDIENCE ?? "")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(privateKey);
  }

  /** A Pub/Sub push body carrying Gmail's notification for `emailAddress`. */
  body(emailAddress: string, historyId: number | string = 1234): string {
    return this.wrap(Buffer.from(JSON.stringify({ emailAddress, historyId })).toString("base64"));
  }

  /** A Pub/Sub push body whose message data is `data`, base64-encoded as given. */
  wrap(data: string): string {
    const messageId = String(++this.messages);
    const publishTime = new Date().toISOString();
    return JSON.stringify({
      message: {
        data,
        messageId,
        message_id: messageId,
        publishTime,
        publish_time: publishTime,
      },
      subscription: SUBSCRIPTION,
    });
  }

  /**
   * Posts Gmail's notification for `emailAddress` to the route as the push subscription would,
   * with a valid token unless `claims` spoil it, and returns the route's answer.
   */
  async notify(
    emailAddress: string,
    options: { historyId?: number | string; claims?: PushTokenClaims } = {},
  ): Promise<Response> {
    const token = await this.token(options.claims);
    return this.post(this.body(emailAddress, options.historyId), `Bearer ${token}`);
  }

  /** Posts any body to the route, with `authorization` as its Authorization header, if any. */
  async post(rawBody: string, authorization?: string): Promise<Response> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (authorization !== undefined) headers.set("Authorization", authorization);
    const url = env.GOOGLE_PUSH_AUDIENCE ?? "http://localhost:3000/api/google/gmail-push";
    // Loaded here rather than at the top, so the setup file that installs the key set doesn't
    // load the whole app before each test file's own imports.
    const { POST } = await import("@/app/api/google/gmail-push/route");
    return POST(new Request(url, { method: "POST", headers, body: rawBody }));
  }

  private googleKeys(): Promise<KeyPair> {
    this.google ??= generateKeyPair("RS256", { extractable: true });
    return this.google;
  }

  private forgerKeys(): Promise<KeyPair> {
    this.forger ??= generateKeyPair("RS256");
    return this.forger;
  }

  readonly handlers = [
    http.get(KEY_SET_URL, async () => {
      const jwk = await exportJWK((await this.googleKeys()).publicKey);
      return HttpResponse.json({ keys: [{ ...jwk, kid: KEY_ID, alg: "RS256", use: "sig" }] });
    }),
  ];
}

export const fakeGooglePush = new FakeGooglePush();
