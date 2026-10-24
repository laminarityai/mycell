// The mark on a run its person started from Ask Mycel, on a message they picked, rather than a
// trigger or an admin by hand.
import { Badge } from "@/components/ui/badge";

export function FromAskMycel() {
  return (
    <Badge
      variant="outline"
      className="ml-2 align-middle"
      title="Its person started it from Ask Mycel, on a message they picked."
    >
      From Ask Mycel
    </Badge>
  );
}
