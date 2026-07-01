import { loadEnvConfig } from "@next/env";
import {
  formatProductionReadinessSummary,
  validateProductionReadiness,
} from "../src/server/operations/production-readiness";

function main() {
  loadEnvConfig(process.cwd());
  const result = validateProductionReadiness(process.env);
  console.log(formatProductionReadinessSummary(result));

  if (result.warnings.length > 0) {
    console.log("warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
