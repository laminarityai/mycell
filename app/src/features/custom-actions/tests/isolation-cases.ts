import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import * as server from "../server";

export const isolationCases = defineIsolationCases(server, {
  getActionSet: notTenantScoped(
    "Until custom actions are stored, every company's action set is the catalog, reading nothing.",
  ),
});
