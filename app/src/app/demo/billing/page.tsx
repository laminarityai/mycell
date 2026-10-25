import { DemoBilling } from "@/features/demo/ui";
import { DemoPage } from "../demo-page";

export default function DemoBillingPage() {
  return <DemoPage title="Billing">{() => <DemoBilling />}</DemoPage>;
}
