#!/usr/bin/env node --import tsx
/**
 * @module cli/soterflow-cli
 * SoterFlow CLI entry point — inbox, sync, task management, config.
 */

import type { WorkItem } from "../channels/base.js";
import { createChannels, getConfiguredChannels, syncAll, getInbox } from "../agent/orchestrator.js";
import { getAllSyncStates } from "../store/sync.js";
import { getAll, updateStatus } from "../store/workitems.js";
import { formatItem } from "./inbox.js";

// ANSI color helpers
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function print(msg: string) {
  console.log(msg);
}

function printError(msg: string) {
  console.error(`${c.red}Error:${c.reset} ${msg}`);
}

/** Parse --key=value and --flag args into a map */
function parseArgs(args: string[]): {
  command: string;
  subcommand: string;
  positional: string[];
  flags: Record<string, string>;
} {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = "true";
      }
    } else {
      positional.push(arg);
    }
  }

  return {
    command: positional[0] ?? "help",
    subcommand: positional[1] ?? "",
    positional: positional.slice(1),
    flags,
  };
}

// ── Commands ──

async function cmdInbox(flags: Record<string, string>) {
  const items = getInbox({
    source: flags.source,
    type: flags.type,
    status: flags.status,
  });

  if (items.length === 0) {
    print(`${c.green}✅ Inbox zero — nothing to do!${c.reset}`);
    return;
  }

  print(`${c.bold}📥 SoterFlow Inbox (${items.length} items)${c.reset}\n`);

  let lastPriority = "";
  for (const item of items) {
    if (item.priority !== lastPriority) {
      lastPriority = item.priority;
      print(`${c.dim}── ${item.priority.toUpperCase()} ──${c.reset}`);
    }
    print(`  ${formatItem(item)}  ${c.gray}[${item.id.slice(0, 12)}]${c.reset}`);
  }
}

async function cmdSync(flags: Record<string, string>) {
  let channels = createChannels();

  if (flags.source) {
    channels = channels.filter((ch) => ch.name === flags.source);
    if (channels.length === 0) {
      printError(`No configured channel matches --source=${flags.source}`);
      process.exit(1);
    }
  }

  if (channels.length === 0) {
    printError(
      "No channels configured. Set tokens in .env (GITHUB_TOKEN, JIRA_TOKEN, SLACK_TOKEN)",
    );
    process.exit(1);
  }

  print(`${c.cyan}🔄 Syncing ${channels.map((ch) => ch.name).join(", ")}...${c.reset}`);

  const { items, stats } = await syncAll(channels);

  print(`${c.green}✅ Sync complete${c.reset}`);
  print(
    `   Total: ${stats.totalItems} items, ${c.bold}${stats.newItems} new${c.reset}, ${stats.duplicatesSkipped} duplicates skipped`,
  );

  for (const [source, s] of Object.entries(stats.perSource)) {
    print(`   ${c.dim}${source}: ${s.total} fetched, ${s.new} new${c.reset}`);
  }

  if (items.length > 0) {
    print(`\n${c.bold}Top items:${c.reset}`);
    for (const item of items.slice(0, 5)) {
      print(`  ${formatItem(item)}`);
    }
    if (items.length > 5) {
      print(
        `  ${c.dim}... and ${items.length - 5} more. Run 'soterflow inbox' to see all.${c.reset}`,
      );
    }
  }
}

async function cmdTask(positional: string[], flags: Record<string, string>) {
  const id = positional[0];
  if (!id) {
    printError("Usage: soterflow task <id> --status=done|dismissed|in_progress|seen");
    process.exit(1);
  }

  const status = flags.status as WorkItem["status"];
  if (!status || !["done", "dismissed", "in_progress", "seen", "new"].includes(status)) {
    printError("Provide --status=done|dismissed|in_progress|seen|new");
    process.exit(1);
  }

  // Find item by prefix match
  const all = getAll();
  const match = all.find((i) => i.id.startsWith(id));
  if (!match) {
    printError(`No item found matching ID prefix "${id}"`);
    process.exit(1);
  }

  updateStatus(match.id, status);
  print(`${c.green}✅ Updated ${match.id.slice(0, 12)} → ${status}${c.reset}`);
  print(`   ${c.dim}${match.title}${c.reset}`);
}

async function cmdConfig(subcommand: string) {
  if (subcommand !== "list" && subcommand !== "") {
    printError(`Unknown config subcommand: ${subcommand}. Try: soterflow config list`);
    process.exit(1);
  }

  print(`${c.bold}⚙️  SoterFlow Configuration${c.reset}\n`);

  const channels = getConfiguredChannels();
  for (const ch of channels) {
    const icon = ch.configured ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    print(`  ${icon} ${ch.name}`);
  }

  const syncStates = getAllSyncStates();
  if (syncStates.length > 0) {
    print(`\n${c.bold}Last sync:${c.reset}`);
    for (const s of syncStates) {
      print(`  ${s.channelName}: ${s.lastSync.toISOString()}`);
    }
  }
}

function cmdHelp() {
  print(`
${c.bold}SoterFlow${c.reset} — Personal work item aggregator

${c.bold}Usage:${c.reset}
  soterflow <command> [options]

${c.bold}Commands:${c.reset}
  ${c.cyan}inbox${c.reset}   [--source=github|jira|slack] [--type=pr|issue|mention|message] [--status=new|seen]
          Show filtered inbox

  ${c.cyan}sync${c.reset}    [--source=github|jira|slack]
          Force sync (all configured channels or specific one)

  ${c.cyan}task${c.reset}    <id> --status=done|dismissed|in_progress|seen|new
          Update item status (id can be a prefix)

  ${c.cyan}config${c.reset}  list
          Show which channels are configured

  ${c.cyan}help${c.reset}    Show this help

${c.bold}Examples:${c.reset}
  soterflow sync
  soterflow inbox --source=github --type=pr
  soterflow task abc123 --status=done
  soterflow config list
`);
}

// ── Main ──

async function main() {
  const { command, subcommand, positional, flags } = parseArgs(process.argv.slice(2));

  try {
    switch (command) {
      case "inbox":
        await cmdInbox(flags);
        break;
      case "sync":
        await cmdSync(flags);
        break;
      case "task":
        await cmdTask(positional, flags);
        break;
      case "config":
        await cmdConfig(subcommand);
        break;
      case "help":
      case "--help":
      case "-h":
        cmdHelp();
        break;
      default:
        printError(`Unknown command: ${command}`);
        cmdHelp();
        process.exit(1);
    }
  } catch (err) {
    printError(String(err));
    process.exit(1);
  }
}

void main();
