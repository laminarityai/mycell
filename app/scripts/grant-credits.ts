// Grants credits to an org by ID, with a short note saying what they're for, for our team
// (ADR-0010; there's no payment UI). Run it from the repo root against the database in
// app/.env:
//
//   pnpm credits:grant <orgId> <credits> <note>
import { runGrantCreditsCommand } from "./grant-credits-command";

async function main(): Promise<void> {
  const { exitCode, output } = await runGrantCreditsCommand(process.argv.slice(2));
  if (exitCode === 0) console.log(output);
  else console.error(output);
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
