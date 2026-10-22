// `pnpm api-index`: builds each registered app's operation index from its API description in
// app/api-descriptions/ (ADR-0018), and writes it beside it, gzipped. Run it after copying a
// new description, and commit the index with it: the builder chat's API lookup reads only the
// index, and a test fails while an index is older than its description.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { load } from "js-yaml";
import { registeredApps } from "@/features/connections/registered-apps";
import { apiIndexPath, buildApiIndex } from "@/features/custom-actions/api-index";

// pnpm runs it from `app/`, which the descriptions' paths are relative to.
const APP_DIR = process.cwd();

function parse(path: string, bytes: Buffer): unknown {
  const text = (path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8");
  const plain = path.replace(/\.gz$/, "");
  return plain.endsWith(".yaml") || plain.endsWith(".yml")
    ? load(text, { json: true })
    : JSON.parse(text);
}

for (const app of registeredApps) {
  const sources = app.apiDescription.files.map(({ path }) => {
    const bytes = readFileSync(join(APP_DIR, path));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { path, sha256, content: parse(path, bytes) };
  });
  const index = buildApiIndex(app.id, sources);
  const out = apiIndexPath(app.id);
  writeFileSync(join(APP_DIR, out), gzipSync(JSON.stringify(index), { level: 9 }));
  console.log(
    `${app.name}: ${String(index.operations.length)} operations, ` +
      `${String(Object.keys(index.types).length)} types, written to ${out}`,
  );
}
