// Sample data for the demo console: a 52-person company using agents for 90 days. It's generated
// from a fixed seed and a fixed "today", so the server and the browser draw the same thing and
// nothing reads the clock. None of it is stored, and none of it is the org's real usage.
import { agentTasks, modelPrices } from "./lib/request-samples";
import type { DemoAgent, DemoGroup, DemoMember, DemoModel, DemoRequest, DemoRoute } from "./types";

/** The demo's "today": every day offset in the sample data counts back from here. */
export const DEMO_TODAY = new Date(Date.UTC(2026, 9, 23));
export const DEMO_DAYS = 90;
export const DEMO_ORG = "Warpgate Labs";

const random = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export const demoDate = (daysAgo: number) => new Date(DEMO_TODAY.getTime() - daysAgo * 86_400_000);

const topGroups: [string, number, string[]][] = [
  ["Engineering", 24850, ["Platform", "Applied AI", "Integrations"]],
  ["Product", 19425, ["Experience", "Product analytics"]],
  ["Support", 16370, ["Customer success", "Technical support"]],
  ["Sales", 22980, ["Enterprise sales", "Partnerships"]],
  ["Operations", 17540, ["Business operations", "IT"]],
  ["Finance", 14860, ["Accounting"]],
  ["Consulting", 28690, ["Client delivery", "Advisory"]],
  ["People", 11235, []],
];

/** Groups and their sub-groups, two levels deep. */
export const demoGroups: DemoGroup[] = topGroups.flatMap(([name, budget, children], index) => {
  const id = index * 100 + 1;
  return [
    { id, name, parentId: null, budget },
    ...children.map((child, offset) => ({
      id: id + offset + 1,
      name: child,
      parentId: id,
      budget: Math.round(budget / (children.length + 1)),
    })),
  ];
});

const firstNames = [
  "Claire",
  "Maria",
  "Rachel",
  "Aria",
  "Jasper",
  "Angela",
  "Sarah",
  "Daniel",
  "Priya",
  "Marcus",
  "Elena",
  "Owen",
  "Grace",
  "Leo",
  "Nina",
  "Theo",
  "Hana",
  "Isaac",
  "Zoe",
  "Ravi",
];
const lastNames = [
  "Morgan",
  "Cooper",
  "Young",
  "Harris",
  "Sullivan",
  "Morris",
  "Johnson",
  "Patel",
  "Kim",
  "Nguyen",
  "Garcia",
  "Chen",
  "Brooks",
  "Reyes",
  "Foster",
  "Lee",
];
const groupSizes = [10, 8, 7, 7, 6, 5, 5, 4];

/** Each member sits in a sub-group, or in the top group when it has none. */
export const demoMembers: DemoMember[] = topGroups.flatMap(([group, , children], groupIndex) =>
  Array.from({ length: groupSizes[groupIndex] }, (_, index) => {
    const id = groupIndex * 20 + index + 1;
    const place = index === 0 || children.length === 0 ? group : children[index % children.length];
    return {
      id,
      name: `${firstNames[(id * 7) % firstNames.length]} ${lastNames[(id * 5) % lastNames.length]}`,
      group: place,
      joinedDaysAgo: index % 6 === 5 ? Math.floor(random(id) * 80) : 400,
    };
  }),
);

export const topGroupOf = (group: string) => {
  const found = demoGroups.find((item) => item.name === group);
  const parent = found?.parentId ? demoGroups.find((item) => item.id === found.parentId) : found;
  return parent?.name ?? group;
};

export const demoAgents: DemoAgent[] = [
  {
    slug: "support-triage",
    name: "Support Triage",
    description: "Classifies new tickets, drafts replies, and escalates urgent cases.",
    group: "Support",
    connections: ["Zendesk", "Slack", "Google Workspace"],
    status: "Running",
  },
  {
    slug: "research-analyst",
    name: "Research Analyst",
    description: "Researches markets and produces source-backed client briefs.",
    group: "Consulting",
    connections: ["Google Workspace", "Notion"],
    status: "Running",
  },
  {
    slug: "meeting-notes",
    name: "Meeting Notes",
    description: "Turns calls into summaries, decisions, owners, and follow-ups.",
    group: "Company",
    connections: ["Microsoft 365", "Slack", "Notion"],
    status: "Running",
  },
  {
    slug: "engineering-copilot",
    name: "Engineering Copilot",
    description: "Reviews pull requests and helps engineers debug services.",
    group: "Engineering",
    connections: ["GitHub", "Jira", "Slack"],
    status: "Running",
  },
  {
    slug: "finance-assistant",
    name: "Finance Assistant",
    description: "Checks monthly reports and prepares variance explanations.",
    group: "Finance",
    connections: ["Microsoft 365", "Google Workspace"],
    status: "Needs review",
  },
  {
    slug: "sales-outreach",
    name: "Sales Outreach",
    description: "Prepares account research and drafts approved follow-up emails.",
    group: "Sales",
    connections: ["Salesforce", "HubSpot", "Google Workspace"],
    status: "Paused",
  },
  {
    slug: "data-analyst",
    name: "Data Analyst",
    description: "Answers questions about company data with charts and short summaries.",
    group: "Company",
    connections: ["Google Workspace", "Microsoft 365"],
    status: "Running",
  },
  {
    slug: "workflow-builder",
    name: "Workflow Builder",
    description: "Automates repeat tasks across connected apps after a person approves the steps.",
    group: "Operations",
    connections: ["Slack", "Google Workspace", "Notion", "Zendesk"],
    status: "Running",
  },
];

export const demoModels: DemoModel[] = modelPrices.map(([model]) => model);

function generateRequests(): DemoRequest[] {
  const requests: DemoRequest[] = [];
  for (let day = 0; day < DEMO_DAYS; day++) {
    const weekday = demoDate(day).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    for (const member of demoMembers) {
      if (day > member.joinedDaysAgo) continue;
      const engagement = 0.25 + random(member.id * 173) * 0.7;
      if (random(member.id * 97 + day * 13) < (weekend ? 0.72 : 0.1 + (1 - engagement) * 0.2))
        continue;
      const count =
        1 + Math.floor(random(member.id * 41 + day * 29) * (weekend ? 4 : 8 + engagement * 26));
      const tasks = agentTasks[topGroupOf(member.group)];
      for (let index = 0; index < count; index++) {
        const n = member.id * 7907 + day * 37 + index * 919;
        const [agent, summaries] = tasks[Math.floor(random(n + 1) * tasks.length)];
        const [model, inputPrice, outputPrice] =
          modelPrices[Math.floor(random(n + 9) ** 1.6 * modelPrices.length)];
        const tokens = 2000 + Math.floor(random(n + 7) ** 2.2 * 58000);
        const cost = (tokens / 1e6) * (0.8 * inputPrice + 0.2 * outputPrice);
        const savings = 0.63 + random(member.id * 19) * 0.24;
        requests.push({
          id: requests.length + 1,
          member: member.id,
          agent,
          model: model.id,
          provider: model.provider,
          task: agent,
          summary: summaries[(member.id + day + index) % summaries.length],
          day,
          tokens,
          latencyMs: Math.round(300 + random(n + 8) ** 2 * 2600),
          cost,
          baseline: cost / (1 - savings),
        });
      }
    }
  }
  return requests;
}

export const demoRequests: DemoRequest[] = generateRequests();

export const demoRoutes: DemoRoute[] = [
  {
    id: 1,
    name: "Company balanced",
    strategy: "Balanced",
    fallback: true,
    maxCost: 18.5,
    enabled: true,
  },
  {
    id: 2,
    name: "Fast replies",
    strategy: "Lowest latency",
    fallback: true,
    maxCost: 6,
    enabled: true,
  },
  {
    id: 3,
    name: "Deep research",
    strategy: "Highest quality",
    fallback: false,
    maxCost: 40,
    enabled: false,
  },
];

export const demoProviders = ["OpenAI", "Anthropic", "Google", "xAI", "DeepInfra", "Fireworks AI"];

export const demoConnections = [
  "Microsoft 365",
  "Google Workspace",
  "Slack",
  "Salesforce",
  "HubSpot",
  "Zendesk",
  "Notion",
  "GitHub",
  "Jira",
];
