// The notifications feature: email to the people in an org, through one transactional email
// provider (Resend), and each person's choice of what they get. The review digest is the first
// email; M8's admin emails reuse `sendEmail`.
export { sendEmail } from "./lib/send-email";
// Each person's own switch for the daily review digest, on the Reviews page.
export { reviewDigestOn, setReviewDigest } from "./lib/settings";
// Called only by the digest job, as the org's system ctx.
export { digestTurnedOff } from "./lib/settings";
// The digest email's signed unsubscribe link: made by the digest job, followed from the email.
export { unsubscribeLink, unsubscribeWithLink } from "./lib/unsubscribe";
