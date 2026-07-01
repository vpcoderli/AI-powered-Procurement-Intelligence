import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  buildLaunchHandoffReport,
  formatLaunchHandoffMarkdown,
} from "../src/server/operations/launch-handoff";

type LaunchHandoffFormat = "markdown" | "json";

interface LaunchHandoffCliOptions {
  allowBlocked: boolean;
  format: LaunchHandoffFormat;
  help: boolean;
  origin: string | null;
  output: string | null;
}

function formatHelp() {
  return [
    "Launch handoff report",
    "",
    "Usage:",
    "  npm run ops:launch-handoff",
    "  npm run ops:launch-handoff -- --format=json --output=../ops-evidence/launch-handoff.json",
    "  npm run ops:launch-handoff -- --allow-blocked",
    "",
    "Options:",
    "  --format=markdown|json  Output format. Default: markdown.",
    "  --output=<path>          Write output to a file.",
    "  --origin=<url>           Local app origin for browser/Stripe commands. Default: http://localhost:3000.",
    "  --allow-blocked          Print/report blockers but exit 0.",
    "  --help                   Print this help.",
    "",
    "The report prints configured markers and blocker names only; it does not print secret values.",
  ].join("\n");
}

function parseArgs(argv: string[]): LaunchHandoffCliOptions {
  const options: LaunchHandoffCliOptions = {
    allowBlocked: false,
    format: "markdown",
    help: false,
    origin: null,
    output: null,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--allow-blocked") {
      options.allowBlocked = true;
      continue;
    }

    if (arg.startsWith("--format=")) {
      const format = arg.slice("--format=".length);
      if (format !== "markdown" && format !== "json") {
        throw new Error("--format must be markdown or json");
      }
      options.format = format;
      continue;
    }

    if (arg.startsWith("--output=")) {
      const output = arg.slice("--output=".length).trim();
      if (!output) throw new Error("--output requires a file path");
      options.output = output;
      continue;
    }

    if (arg.startsWith("--origin=")) {
      const origin = arg.slice("--origin=".length).trim();
      if (!origin) throw new Error("--origin requires a URL");
      options.origin = origin;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function formatReport(format: LaunchHandoffFormat, report: ReturnType<typeof buildLaunchHandoffReport>) {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  return `${formatLaunchHandoffMarkdown(report)}\n`;
}

function writeOutput(outputPath: string, output: string) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, "utf8");
}

try {
  loadEnvConfig(process.cwd());
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(formatHelp());
    process.exit(0);
  }

  const report = buildLaunchHandoffReport(process.env, {
    ...(options.origin ? { origin: options.origin } : {}),
  });
  const output = formatReport(options.format, report);

  if (options.output) {
    writeOutput(options.output, output);
    console.log(`Launch handoff report written to ${options.output}`);
  } else {
    process.stdout.write(output);
  }

  if (!report.ok && !options.allowBlocked) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
