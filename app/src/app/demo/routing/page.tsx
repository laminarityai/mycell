import { DemoRouting } from "@/features/demo/ui";
import { DemoPage } from "../demo-page";

export default function DemoRoutingPage() {
  return <DemoPage title="Routing">{() => <DemoRouting />}</DemoPage>;
}
