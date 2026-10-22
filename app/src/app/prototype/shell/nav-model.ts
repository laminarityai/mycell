// PROTOTYPE, throwaway: every link the app's navigation has once v1 lands, with who sees it and
// where each variant may put it. The variants lay the same links out in different shapes.
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
  Sparkles,
  Tags,
  Workflow,
  Wrench,
} from "lucide-react";
import { CREDITS, FIXTURE_COUNTS } from "../_shared/fixtures";

export type NavGroup = "work" | "company" | "accounts";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Only admins see it. */
  admin: boolean;
  group: NavGroup;
  /** Used most days, so a slim bar keeps it in view. */
  daily: boolean;
  count?: { value: number; tone: "default" | "destructive"; label: string };
};

export const GROUP_LABELS: Record<NavGroup, string> = {
  work: "Your work",
  company: "Company",
  accounts: "Accounts and memory",
};

export const NAV_ITEMS: NavItem[] = [
  {
    key: "reviews",
    label: "Reviews",
    href: "#",
    icon: Inbox,
    admin: false,
    group: "work",
    daily: true,
    count: { value: FIXTURE_COUNTS.waitingReviews, tone: "default", label: "waiting" },
  },
  {
    key: "ask",
    label: "Ask Mycel",
    href: "/prototype/ask",
    icon: Sparkles,
    admin: false,
    group: "work",
    daily: true,
  },
  {
    key: "workflows",
    label: "Workflows",
    href: "#",
    icon: Workflow,
    admin: false,
    group: "work",
    daily: true,
  },
  {
    key: "runs",
    label: "Runs",
    href: "/prototype/runs",
    icon: Activity,
    admin: false,
    group: "work",
    daily: true,
  },
  {
    key: "alerts",
    label: "Alerts",
    href: "/prototype/alerts",
    icon: Bell,
    admin: true,
    group: "company",
    daily: true,
    count: { value: FIXTURE_COUNTS.openAlerts, tone: "destructive", label: "open" },
  },
  {
    key: "builder",
    label: "Builder chat",
    href: "#",
    icon: Bot,
    admin: true,
    group: "company",
    daily: false,
  },
  {
    key: "credits",
    label: "Credits",
    href: "/prototype/credits",
    icon: Coins,
    admin: true,
    group: "company",
    daily: false,
  },
  {
    key: "custom-actions",
    label: "Custom actions",
    href: "#",
    icon: Wrench,
    admin: true,
    group: "company",
    daily: false,
  },
  {
    key: "capability-requests",
    label: "Capability requests",
    href: "#",
    icon: GitPullRequestArrow,
    admin: true,
    group: "company",
    daily: false,
  },
  {
    key: "tags",
    label: "Manage tags",
    href: "#",
    icon: Tags,
    admin: true,
    group: "company",
    daily: false,
  },
  {
    key: "connections",
    label: "Connections",
    href: "#",
    icon: Plug,
    admin: false,
    group: "accounts",
    daily: false,
  },
  {
    key: "org",
    label: "Your org",
    href: "#",
    icon: Building2,
    admin: false,
    group: "accounts",
    daily: false,
  },
  {
    key: "memory-log",
    label: "Memory log",
    href: "#",
    icon: History,
    admin: false,
    group: "accounts",
    daily: false,
  },
  {
    key: "memory",
    label: "Memory settings",
    href: "#",
    icon: Brain,
    admin: true,
    group: "accounts",
    daily: false,
  },
];

/** The links one person sees, in the model's order. */
export const itemsFor = (admin: boolean) => NAV_ITEMS.filter((item) => admin || !item.admin);

/** Today's order (reviews/page.tsx) with v1's links added where they read best in a row. */
export const FLAT_ORDER = [
  "reviews",
  "ask",
  "workflows",
  "runs",
  "connections",
  "org",
  "memory-log",
  "alerts",
  "credits",
  "builder",
  "tags",
  "memory",
  "custom-actions",
  "capability-requests",
];

const NUMBER = new Intl.NumberFormat("en-US");

/** "3,420". */
export const formatCredits = (credits: number) => NUMBER.format(credits);

export const CREDIT_STATUS = {
  balance: CREDITS.balance,
  runwayDays: CREDITS.runwayDays,
};

/** Whether the out-of-credits banner shows: only admins see it (M8 story 41). */
export const showsBanner = (params: Record<string, string>) =>
  params.as === "admin" && params.credits === "out";
