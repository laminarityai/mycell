import { DemoKeys } from "@/features/demo/ui";
import { DemoPage } from "../demo-page";

export default function DemoKeysPage() {
  return <DemoPage title="Bring your own key">{() => <DemoKeys />}</DemoPage>;
}
