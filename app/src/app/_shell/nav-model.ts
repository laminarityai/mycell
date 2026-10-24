// The app shell's sidebar: every item, the group it sits in, and who sees it. Pure, so the
// sidebar (a client component), the error page and the tests all read the same list.
import {
  Activity,
  Bell,
  Bot,
  Brain,
  Building2,
  Coins,
  GitPullRequestArrow,
  History,
  Inbox,
  type LucideIcon,
  Plug,
  Tags,
  Workflow,
  Wrench,
} from "lucide-react";

export type NavGroupKey = "work" | "company" | "accounts";

export type NavKey =
  | "reviews"
  | "workflows"
  | "alerts"
  | "runs"
  | "builder"
  | "credits"
  | "custom-actions"
  | "capability-requests"
  | "tags"
  | "connections"
  | "org"
  | "memory-log"
  | "memory";

export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Only admins see it. */
  admin: boolean;
  /**
   * What the item's count counts, read after the number ("2 waiting"). An item without one
   * never shows a count.
   */
  counts?: { label: string; tone: "default" | "destructive" };
};

export type NavGroup = { key: NavGroupKey; label: string; items: NavItem[] };

/** The sidebar's groups in order, each with every item it can hold. */
const NAV_GROUPS: NavGroup[] = [
  {
    key: "work",
    label: "Your work",
    items: [
      {
        key: "reviews",
        label: "Reviews",
        href: "/reviews",
        icon: Inbox,
        admin: false,
        counts: { label: "waiting", tone: "default" },
      },
      { key: "workflows", label: "Workflows", href: "/workflows", icon: Workflow, admin: false },
      { key: "runs", label: "Runs", href: "/runs", icon: Activity, admin: false },
    ],
  },
  {
    key: "company",
    label: "Company",
    items: [
      {
        key: "alerts",
        label: "Alerts",
        href: "/alerts",
        icon: Bell,
        admin: true,
        counts: { label: "open", tone: "destructive" },
      },
      { key: "builder", label: "Builder chat", href: "/builder", icon: Bot, admin: true },
      { key: "credits", label: "Credits", href: "/credits", icon: Coins, admin: true },
      {
        key: "custom-actions",
        label: "Custom actions",
        href: "/custom-actions",
        icon: Wrench,
        admin: true,
      },
      {
        key: "capability-requests",
        label: "Capability requests",
        href: "/capability-requests",
        icon: GitPullRequestArrow,
        admin: true,
      },
      { key: "tags", label: "Manage tags", href: "/tags", icon: Tags, admin: true },
    ],
  },
  {
    key: "accounts",
    label: "Accounts and memory",
    items: [
      { key: "connections", label: "Connections", href: "/connections", icon: Plug, admin: false },
      { key: "org", label: "Your org", href: "/org", icon: Building2, admin: false },
      {
        key: "memory-log",
        label: "Memory log",
        href: "/memory/access-log",
        icon: History,
        admin: false,
      },
      { key: "memory", label: "Memory settings", href: "/memory", icon: Brain, admin: true },
    ],
  },
];

/**
 * The groups one person sees, each with only the items they may open. A group left with no
 * items (Company, for a member) isn't shown at all.
 */
export function navGroupsFor(admin: boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => admin || !item.admin),
  })).filter((group) => group.items.length > 0);
}

/** Counts by item, such as how many reviews wait; an item missing from it shows none. */
export type NavCounts = Partial<Record<NavKey, number>>;
