import { DemoDashboard } from "@/features/demo/ui";
import { DemoPage } from "./demo-page";

export default function DemoDashboardPage() {
  return <DemoPage title="Dashboard">{() => <DemoDashboard />}</DemoPage>;
}
