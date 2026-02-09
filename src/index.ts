#!/usr/bin/env node

import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadJiraConfig } from "./config.js";
import { JiraApiError, JiraClient } from "./jira-client.js";
import type {
  AddCommentInput,
  CreateIssueInput,
  IssueReadOptions,
  LinkIssueInput,
  SearchIssuesInput,
  TransitionIssueInput,
  UpdateIssueInput
} from "./types.js";

const nonEmpty = z.string().trim().min(1);
const nonEmptyArray = z.array(nonEmpty).max(100);

const config = loadJiraConfig();
const jira = new JiraClient(config);

const server = new McpServer({
  name: "jira-focused-cloud-mcp",
  version: "0.1.0"
});

server.registerTool(
  "jira_get_issue",
  {
    title: "Get Jira Issue",
    description:
      "Read one Jira issue by key with focused business fields, relations (parent/subtasks/links), and context-safe comments.",
    inputSchema: {
      issueKey: nonEmpty.describe("Jira issue key, e.g. PROJ-123"),
      skipComments: z
        .boolean()
        .optional()
        .describe("If true, do not load comments. Default: false."),
      loadOnlyLast3Comments: z
        .boolean()
        .optional()
        .describe("If true, return only the 3 most recent comments. Default: true.")
    }
  },
  async ({ issueKey, skipComments, loadOnlyLast3Comments }) =>
    runTool(async () => ({
      issue: await jira.getIssue(
        issueKey,
        buildIssueReadOptions({ skipComments, loadOnlyLast3Comments })
      )
    }))
);

server.registerTool(
  "jira_create_issue",
  {
    title: "Create Jira Issue",
    description:
      "Create a Jira issue using focused fields only. Optionally sets status via transition after create.",
    inputSchema: {
      projectKey: nonEmpty.describe("Project key, e.g. PROJ"),
      issueType: nonEmpty.describe("Issue type name or id, e.g. Task, Bug, Story"),
      summary: nonEmpty.describe("Issue summary/title"),
      description: z
        .string()
        .optional()
        .describe("Plain text description. Server converts this to Atlassian Document Format."),
      fixVersions: nonEmptyArray
        .optional()
        .describe("Optional list of project version names or ids for fixVersions."),
      affectedVersions: nonEmptyArray
        .optional()
        .describe("Optional list of project version names or ids for affected versions."),
      priority: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional priority name or id."),
      severity: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional severity value (requires JIRA_SEVERITY_FIELD_ID)."),
      status: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional target status name or transition id applied after issue creation.")
    }
  },
  async (args) => runTool(async () => jira.createIssue(args as CreateIssueInput))
);

server.registerTool(
  "jira_update_issue",
  {
    title: "Update Jira Issue",
    description:
      "Update focused Jira issue fields. Optionally transitions status and controls comment loading in response.",
    inputSchema: {
      issueKey: nonEmpty.describe("Jira issue key, e.g. PROJ-123"),
      summary: z.string().trim().min(1).optional(),
      description: z
        .string()
        .nullable()
        .optional()
        .describe("Plain text description. Use null to clear."),
      fixVersions: nonEmptyArray
        .optional()
        .describe("Set fixVersions by version names/ids. Use [] to clear."),
      affectedVersions: nonEmptyArray
        .optional()
        .describe("Set affected versions by version names/ids. Use [] to clear."),
      priority: z
        .string()
        .trim()
        .min(1)
        .nullable()
        .optional()
        .describe("Priority name/id. Use null to clear."),
      severity: z
        .string()
        .trim()
        .min(1)
        .nullable()
        .optional()
        .describe("Severity value. Use null to clear (requires JIRA_SEVERITY_FIELD_ID)."),
      status: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional target status name or transition id."),
      notifyUsers: z
        .boolean()
        .optional()
        .describe("Whether Jira should notify users about the update."),
      skipComments: z
        .boolean()
        .optional()
        .describe("If true, do not load comments in the returned issue. Default: false."),
      loadOnlyLast3Comments: z
        .boolean()
        .optional()
        .describe("If true, return only 3 most recent comments in returned issue. Default: true.")
    }
  },
  async (args) => runTool(async () => jira.updateIssue(args as UpdateIssueInput))
);

server.registerTool(
  "jira_transition_issue",
  {
    title: "Transition Jira Issue",
    description:
      "Move a Jira issue to another status via workflow transition and return focused issue data.",
    inputSchema: {
      issueKey: nonEmpty.describe("Jira issue key, e.g. PROJ-123"),
      toStatus: nonEmpty.describe("Target status name or transition id."),
      skipComments: z
        .boolean()
        .optional()
        .describe("If true, do not load comments in the returned issue. Default: false."),
      loadOnlyLast3Comments: z
        .boolean()
        .optional()
        .describe("If true, return only 3 most recent comments in returned issue. Default: true.")
    }
  },
  async (args) => runTool(async () => jira.transitionIssue(args as TransitionIssueInput))
);

server.registerTool(
  "jira_add_comment",
  {
    title: "Add Jira Comment",
    description:
      "Add a plain text comment to a Jira issue key. The server stores it as ADF in Jira.",
    inputSchema: {
      issueKey: nonEmpty.describe("Jira issue key, e.g. PROJ-123"),
      body: nonEmpty.describe("Plain text comment body")
    }
  },
  async (args) => runTool(async () => jira.addComment(args as AddCommentInput))
);

server.registerTool(
  "jira_link_issue",
  {
    title: "Link Jira Issues",
    description:
      "Create a business relation between two issues (e.g. blocks, is blocked by, relates to, duplicates).",
    inputSchema: {
      issueKey: nonEmpty.describe("Primary issue key, e.g. PROJ-123"),
      targetIssueKey: nonEmpty.describe("Target issue key, e.g. PROJ-456"),
      relation: nonEmpty.describe("Business relation label, e.g. blocks, is blocked by, relates to."),
      comment: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional plain text comment added while creating the link.")
    }
  },
  async (args) => runTool(async () => jira.linkIssue(args as LinkIssueInput))
);

server.registerTool(
  "jira_project_baseline",
  {
    title: "Get Project Baseline",
    description:
      "Return compressed project baseline: issue types, priorities, versions, field profile, active sprints, and workflow transitions.",
    inputSchema: {
      projectKey: nonEmpty.describe("Project key, e.g. PROJ")
    }
  },
  async ({ projectKey }) =>
    runTool(async () => ({ baseline: await jira.getProjectBaseline(projectKey) }))
);

server.registerTool(
  "jira_search_issues",
  {
    title: "Search Jira Issues",
    description:
      "Search Jira issues with focused filters. Returns constrained business fields with parent/subtasks/linked-issues, not full Jira payload.",
    inputSchema: {
      projectKey: z.string().trim().min(1).optional(),
      issueKeys: nonEmptyArray.optional(),
      issueTypes: nonEmptyArray.optional(),
      summaryContains: z.string().trim().min(1).optional(),
      descriptionContains: z.string().trim().min(1).optional(),
      fixVersions: nonEmptyArray.optional(),
      affectedVersions: nonEmptyArray.optional(),
      statuses: nonEmptyArray.optional(),
      priorities: nonEmptyArray.optional(),
      severities: nonEmptyArray.optional(),
      jql: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional raw JQL; if provided with filters, server combines them with AND."),
      maxResults: z.number().int().min(1).max(100).optional(),
      nextPageToken: z.string().trim().min(1).optional()
    }
  },
  async (args) => runTool(async () => jira.searchIssues(args as SearchIssuesInput))
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("jira-focused-cloud-mcp is running on stdio");
}

main().catch((error) => {
  console.error("Fatal startup error:", formatError(error));
  process.exit(1);
});

async function runTool<T>(operation: () => Promise<T>) {
  try {
    const payload = await operation();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(payload, null, 2)
        }
      ]
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: formatError(error)
        }
      ]
    };
  }
}

function buildIssueReadOptions(options: {
  skipComments?: boolean | undefined;
  loadOnlyLast3Comments?: boolean | undefined;
}): IssueReadOptions {
  return {
    ...(typeof options.skipComments === "boolean"
      ? { skipComments: options.skipComments }
      : {}),
    ...(typeof options.loadOnlyLast3Comments === "boolean"
      ? { loadOnlyLast3Comments: options.loadOnlyLast3Comments }
      : {})
  };
}

function formatError(error: unknown): string {
  if (error instanceof JiraApiError) {
    const body = error.body?.trim();
    if (body) {
      return `${error.message}\nJira response body: ${body}`;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
