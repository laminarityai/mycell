import { DEMO_ORG } from "@/features/demo/data";
import { DemoTeams } from "@/features/demo/ui";
import { DemoPage } from "../demo-page";

export default function DemoTeamsPage() {
  return <DemoPage title="Teams & Access">{() => <DemoTeams org={DEMO_ORG} />}</DemoPage>;
}
