import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import * as server from "../server";

// Every server.ts export needs a case here. A real case seeds through the entry functions
// with orgs.orgA.admin.ctx and proves org B's rows stay invisible and unchanged.
export const isolationCases = defineIsolationCases(server, {
  greet: notTenantScoped("formats a name; reads and writes no org data"),
});
