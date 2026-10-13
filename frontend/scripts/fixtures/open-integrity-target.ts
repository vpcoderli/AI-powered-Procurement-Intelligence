/**
 * The process src/server/integrity/open-target.test.ts spawns: it opens the integrity target of the environment it is
 * given (a JSON object, argument 1) read-only, prints what it opened, and closes it.
 *
 * It is a script file with a static import, run as `node --import tsx <file>`, which is how the integrity scripts run.
 * The test used to hand the same lines to `node --input-type=module -e` and `import()` the module from there. On Node 20
 * that import answers a TypeScript module (CommonJS, as frontend/package.json has no "type") with a namespace whose only
 * export is `default`, so `openIntegrityTarget` was not a function; Node 24 also lists the named exports, which is why it
 * only failed in CI. A static import in a script file does not go through that interop on either version.
 */
import { openIntegrityTarget } from "../../src/server/integrity/open-target";

async function main() {
  const env = JSON.parse(process.argv[2] ?? "{}") as NodeJS.ProcessEnv;
  const opened = await openIntegrityTarget(env, { readonly: true });
  console.log(opened.description);
  await opened.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
