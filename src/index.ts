#!/usr/bin/env node

import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadJiraConfig } from "./config.js";
import { JiraApiError, JiraClient } from "./jira-client.js";
import type {
  AddCommentInput,
  AssignIssueToSprintInput,
  CreateIssueInput,
  IssueReadOptions,
  ListSprintsInput,
  LinkIssueInput,
  SearchIssuesByJqlInput,
  SearchIssuesInput,
  TransitionIssueInput,
  UpdateIssueInput
} from "./types.js";

const nonEmpty = z.string().trim().min(1);
const nonEmptyArray = z.array(nonEmpty).max(100);
const descriptionFormatSchema = z
  .enum(["plain_text", "adf"])
  .optional()
  .describe(
    "Description format. plain_text: string text. adf: Atlassian Document Format JSON object. Default: plain_text."
  );
const descriptionInputSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);

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
      "Read one focused Jira issue by key. Description defaults to plain_text and can be returned as ADF.",
    inputSchema: {
      issueKey: nonEmpty.describe("Jira issue key, e.g. PROJ-123"),
      skipComments: z
        .boolean()
        .optional()
        .describe("If true, do not load comments. Default: false."),
      loadOnlyLast3Comments: z
        .boolean()
        .optional()
        .describe("If true, return only the 3 most recent comments. Default: true."),
      descriptionFormat: descriptionFormatSchema
    }
  },
  async ({ issueKey, skipComments, loadOnlyLast3Comments, descriptionFormat }) =>
    runTool(async () => ({
      issue: await jira.getIssue(
        issueKey,
        buildIssueReadOptions({ skipComments, loadOnlyLast3Comments, descriptionFormat })
      )
    }))
);

server.registerTool(
  "jira_create_issue",
  {
    title: "Create Jira Issue",
    description:
      "Create a focused Jira issue. Description accepts plain_text by default or ADF when requested.",
    inputSchema: {
      projectKey: nonEmpty.describe("Project key, e.g. PROJ"),
      issueType: nonEmpty.describe("Issue type name or id, e.g. Task, Bug, Story"),
      summary: nonEmpty.describe("Issue summary/title"),
      description: descriptionInputSchema
        .optional()
        .describe(
          "Description content. Use plain text string by default, or an ADF JSON object when descriptionFormat=adf."
        ),
      descriptionFormat: descriptionFormatSchema,
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
      "Update focused Jira fields. Description supports plain_text (default) or ADF; optional status transition.",
    inputSchema: {
      issueKey: nonEmpty.describe("Jira issue key, e.g. PROJ-123"),
      summary: z.string().trim().min(1).optional(),
      description: descriptionInputSchema
        .nullable()
        .optional()
        .describe(
          "Description update. Use plain text string by default, ADF object when descriptionFormat=adf, or null to clear."
        ),
      descriptionFormat: descriptionFormatSchema,
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
      "Move issue to another status via workflow transition and return focused issue data.",
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
        .describe("If true, return only 3 most recent comments in returned issue. Default: true."),
      descriptionFormat: descriptionFormatSchema
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
  "jira_list_sprints",
  {
    title: "List Jira Sprints",
    description:
      "List scrum sprints for a project with clear textual context (state, goal, dates, board).",
    inputSchema: {
      projectKey: nonEmpty.describe("Project key, e.g. PROJ"),
      state: z
        .enum(["active", "future", "closed", "all"])
        .optional()
        .describe("Sprint state filter. Default: active."),
      boardName: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional exact board name filter."),
      maxResultsPerBoard: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("How many sprints to fetch per board. Default: 20.")
    }
  },
  async (args) => runTool(async () => jira.listSprints(args as ListSprintsInput))
);

server.registerTool(
  "jira_assign_issue_to_sprint",
  {
    title: "Assign Jira Issue To Sprint",
    description:
      "Assign issue to sprint via Jira Agile API. Use sprintId (preferred) or sprintName.",
    inputSchema: {
      issueKey: nonEmpty.describe("Jira issue key, e.g. PROJ-123"),
      sprintId: z.number().int().positive().optional().describe("Target sprint id."),
      sprintName: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Target sprint name (used when sprintId is not provided)."),
      projectKey: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional project key for sprintName lookup. If omitted, server resolves from issue."),
      boardName: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Optional exact board name filter when sprintName is used."),
      loadIssueAfterAssign: z
        .boolean()
        .optional()
        .describe("If true (default), returns refreshed focused issue after assignment."),
      skipComments: z
        .boolean()
        .optional()
        .describe("If loadIssueAfterAssign=true, skip comments in returned issue. Default: false."),
      loadOnlyLast3Comments: z
        .boolean()
        .optional()
        .describe("If loadIssueAfterAssign=true, return only last 3 comments. Default: true."),
      descriptionFormat: descriptionFormatSchema.describe(
        "If loadIssueAfterAssign=true, choose description output format. Default: plain_text."
      )
    }
  },
  async (args) => runTool(async () => jira.assignIssueToSprint(args as AssignIssueToSprintInput))
);

server.registerTool(
  "jira_search_issues_by_jql",
  {
    title: "Search Jira Issues By JQL (Safe List)",
    description:
      "Run raw JQL and return a strict, context-safe list only: key, summary, fixVersions, sprints, assignee, reporter, priority, status. Hard limit: 50 results.",
    inputSchema: {
      jql: nonEmpty.describe("Raw Jira JQL query.")
    }
  },
  async ({ jql }) => runTool(async () => jira.searchIssuesByJql({ jql } as SearchIssuesByJqlInput))
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
  descriptionFormat?: "plain_text" | "adf" | undefined;
}): IssueReadOptions {
  return {
    ...(typeof options.skipComments === "boolean"
      ? { skipComments: options.skipComments }
      : {}),
    ...(typeof options.loadOnlyLast3Comments === "boolean"
      ? { loadOnlyLast3Comments: options.loadOnlyLast3Comments }
      : {}),
    ...(options.descriptionFormat ? { descriptionFormat: options.descriptionFormat } : {})
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
