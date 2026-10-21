import { Badge } from "@/components/ui/badge";
import type { RiskLevel } from "@/features/policy/types";

const RISK_LABELS: Record<RiskLevel, string> = {
  read: "Read",
  internal_reversible: "Internal, reversible",
  external_send: "External send",
  financial: "Financial",
  destructive: "Destructive",
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Badge variant={risk === "read" ? "secondary" : "outline"}>{RISK_LABELS[risk]}</Badge>;
}
