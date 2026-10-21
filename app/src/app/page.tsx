import { redirect } from "next/navigation";

// Opening Mycel lands on the Reviews page, everyone's main screen (ADR-0013).
export default function HomePage() {
  redirect("/reviews");
}
