import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { run as runNodeTests } from "node:test";
import { spec } from "node:test/reporters";
import { glob } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function run(): Promise<void> {
  const testsRoot = path.resolve(__dirname, "..");
  const files = await glob("**/*.test.js", { cwd: testsRoot });
  const absoluteFiles = files.map((f) => path.join(testsRoot, f));

  let failures = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = runNodeTests({
      files: absoluteFiles,
      isolation: "none",
      concurrency: false,
    });
    stream.on("test:fail", () => {
      failures += 1;
    });
    stream.once("end", () => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
    stream.once("error", reject);
    stream.compose(new spec()).pipe(process.stdout);
  });
}
