import { DemoLogs } from "@/features/demo/ui";
import { DemoPage } from "../demo-page";

export default function DemoLogsPage() {
  return <DemoPage title="Logs">{() => <DemoLogs />}</DemoPage>;
}
