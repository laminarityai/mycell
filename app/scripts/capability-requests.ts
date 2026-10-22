// Lists every company's capability requests and changes their status, for our team (ADR-0018;
// there's no admin UI for our team). Run it from the repo root against the database in
// app/.env:
//
//   pnpm capability-requests [list]
//   pnpm capability-requests show <requestId>
//   pnpm capability-requests set <requestId> <open|building|shipped|declined> [note]
import { runCapabilityRequestsCommand } from "./capability-requests-commands";

async function main(): Promise<void> {
  const { exitCode, output } = await runCapabilityRequestsCommand(process.argv.slice(2));
  if (exitCode === 0) console.log(output);
  else console.error(output);
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
