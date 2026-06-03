import { loadEnvConfig } from "@next/env";
import {
  formatProductionBillingPreflightSummary,
  validateProductionBillingPreflight,
} from "../src/server/billing/production-preflight";

function main() {
  loadEnvConfig(process.cwd());
  const result = validateProductionBillingPreflight(process.env);
  console.log(formatProductionBillingPreflightSummary(result));

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
