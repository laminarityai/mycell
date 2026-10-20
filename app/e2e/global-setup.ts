// Playwright global setup: create the e2e database if it's missing and apply the committed
// migrations, the same setup Vitest runs against its own database.
import { setup } from "@/db/testing/global-setup";

// Playwright requires the global setup as a default export.
export default setup;
