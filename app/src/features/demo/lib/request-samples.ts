// What the generated demo requests are made of: model list prices, and the work each team
// sends to which agent.
import type { DemoModel } from "../types";

/** List prices in dollars per million tokens: [input, output]. */
export const modelPrices: [DemoModel, number, number][] = [
  [{ id: "gpt-6-sol", label: "GPT-6 Sol", provider: "OpenAI" }, 2.5, 10],
  [{ id: "gpt-6-luna", label: "GPT-6 Luna", provider: "OpenAI" }, 0.4, 1.6],
  [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "Anthropic" }, 3, 15],
  [{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "Anthropic" }, 0.8, 4],
  [{ id: "gemini-3-8-flash", label: "Gemini 3.8 Flash", provider: "Google" }, 0.3, 2.5],
  [{ id: "grok-4-7", label: "Grok 4.7", provider: "xAI" }, 3, 15],
  [{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "DeepInfra" }, 0.5, 2.2],
  [{ id: "glm-5-3", label: "GLM 5.3", provider: "DeepInfra" }, 0.6, 2.2],
];
export const agentTasks: Record<string, [string, string[]][]> = {
  Engineering: [
    [
      "Engineering Copilot",
      [
        "Review a pull request for the billing service",
        "Debug an intermittent timeout in the reporting API",
        "Write tests for the access-control service",
      ],
    ],
    ["Workflow Builder", ["Automate the weekly deploy checklist"]],
  ],
  Product: [
    [
      "Data Analyst",
      [
        "Summarize feature adoption for the roadmap review",
        "Compare activation across onboarding cohorts",
      ],
    ],
    ["Meeting Notes", ["Pull action items from the design review"]],
  ],
  Support: [
    [
      "Support Triage",
      ["Draft a reply to a client escalation", "Classify this morning's new tickets"],
    ],
    ["Meeting Notes", ["Summarize the support standup"]],
  ],
  Sales: [
    [
      "Sales Outreach",
      ["Draft a proposal for a healthcare client", "Write a follow-up after a discovery call"],
    ],
    ["Research Analyst", ["Research a prospect before the first call"]],
  ],
  Operations: [
    ["Workflow Builder", ["Sync new leads to Slack", "Automate the vendor onboarding form"]],
    ["Data Analyst", ["Build a weekly utilization report"]],
  ],
  Finance: [
    [
      "Finance Assistant",
      ["Update the revenue forecast with October actuals", "Explain the variance in gross margin"],
    ],
    ["Data Analyst", ["Compare team spend against plan"]],
  ],
  Consulting: [
    [
      "Research Analyst",
      ["Size the market for an advisory offering", "Summarize recent industry reports"],
    ],
    ["Meeting Notes", ["Write a recap of the client steering committee"]],
  ],
  People: [
    ["Workflow Builder", ["Create onboarding material for new hires"]],
    ["Meeting Notes", ["Summarize feedback from the hiring panel"]],
  ],
};
