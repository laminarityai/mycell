import { DemoAgents } from "@/features/demo/ui";
import { DemoPage } from "../demo-page";

export default function DemoAgentsPage() {
  return <DemoPage title="Agents">{() => <DemoAgents />}</DemoPage>;
}
