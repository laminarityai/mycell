import { DemoModels } from "@/features/demo/ui";
import { DemoPage } from "../demo-page";

export default function DemoModelsPage() {
  return <DemoPage title="Models & Providers">{() => <DemoModels />}</DemoPage>;
}
