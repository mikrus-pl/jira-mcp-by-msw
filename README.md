# Jira Focused MCP Server (Cloud)

MCP server for Jira Cloud with a constrained data abstraction, designed to avoid flooding the LLM context with full Jira payloads.

## Design Goals

- Business-first output: returns only curated fields instead of full Jira payloads.
- Context-safe defaults: comments default to last 3 only.
- Low client complexity: hides Jira REST API details behind stable tools.

## What It Does

This server exposes twelve tools:

1. `jira_get_issue`
2. `jira_create_issue`
3. `jira_update_issue`
4. `jira_transition_issue`
5. `jira_add_comment`
6. `jira_link_issue`
7. `jira_project_baseline`
8. `jira_project_assignable_users`
9. `jira_list_sprints`
10. `jira_assign_issue_to_sprint`
11. `jira_search_issues_by_jql`
12. `jira_search_issues`

All tools intentionally use a focused issue model:

- `url` (direct Jira UI link: `/browse/{issueKey}`)
- `summary`
- `description` (default plain text; optional ADF mode for read/write)
- `fixVersions`
- `affectedVersions`
- `status`
- `priority`
- `severity` (mapped via configurable field)
- `parent` / `subtasks` / `linkedIssues`
- `comments` (default: last 3 only for context protection)

## Requirements

- Node.js 22+
- Jira Cloud account + API token (or a pre-built `Authorization` header)

## Configuration

Use MCP client configuration only.

- Put all `JIRA_*` variables under the MCP server `env` block.

## Get Jira Credentials (Step-By-Step)

1. **Find your Jira base URL**
   - Open Jira in your browser and copy the site origin, e.g. `https://your-domain.atlassian.net`.
2. **Create an API token (Jira Cloud)**
   - Create a token at `https://id.atlassian.com/manage-profile/security/api-tokens`.
   - Keep it private. Treat it like a password.
3. **Pick the email address**
   - Use the email of your Atlassian account (the same account that can access the Jira site).
4. **Optional: figure out the Severity custom field**
   - If your project uses a custom Severity field, find its field id (often `customfield_12345`).
   - Quick way (requires auth):
```bash
curl -sS -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  "${JIRA_BASE_URL}/rest/api/3/field" | head
```
   - Search the output for a field whose `name` is something like `Severity` and use its `id`.
   - If the field is a select list, use `JIRA_SEVERITY_VALUE_TYPE=option` (default).

## Install

```bash
npm install
npm run build
```

## Add This Server To An MCP Client (Step-By-Step)

This is a **stdio** MCP server. Most MCP clients need the same 4 things:

1. **Transport**: `STDIO`
2. **Command**: `node`
3. **Arguments**: absolute path to `dist/index.js`
4. **Environment variables**: `JIRA_*`

### Step 0: Build Once (Required)

From the repo root:

```bash
npm install
npm run build
```

You should have `dist/index.js` afterwards.

Important: in MCP clients, **use an absolute path** to `dist/index.js` (not `./dist/index.js`), because the client usually starts the server with its own working directory.

To get the absolute path quickly:

```bash
echo "$(pwd)/dist/index.js"
```

### MCP Client Setup

Use `JIRA_*` directly in the MCP client.

- `command`: `node`
- `args`: `["/absolute/path/to/jira-mcp-by-msw/dist/index.js"]`
- `env`: add your `JIRA_*` variables
- `workingDirectory`: optional (can be empty)

If your client has a single “command line” field instead of `command` + `args`, use:

- `node /absolute/path/to/jira-mcp-by-msw/dist/index.js`

### Codex App (UI) Example (Idiot-Proof / Idioto-Odporne)

In Codex App, when you add a “custom MCP” server:

1. Select `STDIO`.
2. Fill the fields like this:
   - **Name**: `jira-focused` (any name is fine)
   - **Command to launch**: `node`
   - **Arguments**: `/absolute/path/to/jira-mcp-by-msw/dist/index.js`
   - **Environment variables** (recommended): add `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (and optional `JIRA_SEVERITY_*`)
   - **Working directory**: optional
3. Save.

How to verify it actually started:

- Check the client logs; this server prints `jira-focused-cloud-mcp is running on stdio` to stderr on successful startup.

## Environment Variables

Required:

- `JIRA_BASE_URL`
  - What: Jira Cloud site URL, e.g. `https://your-domain.atlassian.net` (no trailing slash).
  - Where: your Jira site address in the browser.
- Auth option A (recommended for Jira Cloud):
  - `JIRA_EMAIL`
    - What: Atlassian account email used to authenticate.
  - `JIRA_API_TOKEN`
    - What: API token generated in Atlassian.
    - Where: `https://id.atlassian.com/manage-profile/security/api-tokens`
- Auth option B:
  - `JIRA_AUTH_HEADER`
    - What: full `Authorization` header value.
    - Example: `Basic <base64(email:api_token)>` or `Bearer <token>`.

Optional:

- `JIRA_REQUEST_TIMEOUT_MS`
  - What: request timeout in milliseconds.
  - Why: protects the MCP client from long-hanging Jira calls.
  - Default: `20000`
- `JIRA_SEVERITY_FIELD_ID`
  - What: Jira field id to read/write Severity, e.g. `customfield_12345`.
  - Why: many Jira projects do not have a built-in Severity field; this tells the server which field to use.
  - Where: `/rest/api/3/field` list (see command above).
- `JIRA_SEVERITY_JQL_FIELD`
  - What: field identifier used in JQL filters for `jira_search_issues`.
  - Default: `JIRA_SEVERITY_FIELD_ID`, otherwise `severity`.
  - Typical values:
    - `customfield_12345` (recommended if Severity is a custom field)
    - `severity` (only if your Jira instance supports it as a JQL field)
- `JIRA_SEVERITY_VALUE_TYPE`
  - What: how to send Severity when setting/updating issues.
  - Default: `option`
  - Values:
    - `option`: for select-list fields (sends `{ value: "..." }`)
    - `string`: for free-text fields (sends `"..."`)
    - `number`: for numeric fields (sends `123`)

### Verify Auth (Optional)

```bash
curl -sS -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
  "${JIRA_BASE_URL}/rest/api/3/myself" | head
```

## Execution Identity And Key Permissions

Important identity rule:

- The MCP server does not have its own Jira identity.
- The agent executes Jira actions as the Jira user from provided credentials (`JIRA_EMAIL` + `JIRA_API_TOKEN`, or `JIRA_AUTH_HEADER`).
- Permissions, issue security, workflow rules, and audit trail are all evaluated against that user.

Key permissions to verify:

- For `jira_get_issue`, `jira_search_issues`, `jira_search_issues_by_jql`, `jira_project_baseline`
  - Browse projects and issue visibility (including issue security levels).
- For `jira_project_assignable_users`
  - Browse users and groups (global Jira permission), plus project visibility for assignable scope.
- For `jira_create_issue`
  - Create issues in target project.
- For `jira_update_issue`
  - Edit issues.
- For `jira_transition_issue`
  - Transition issues.
- For `jira_add_comment`
  - Add comments.
- For `jira_link_issue`
  - Link issues.
- For `jira_list_sprints`
  - Access Scrum board(s) and their sprints.
- For `jira_assign_issue_to_sprint`
  - Edit issues and permission to manage sprint membership on the board (commonly Manage sprints).

## Run

Development:

```bash
npm run dev
```

Production (compiled):

```bash
npm run build
npm start
```

## MCP Client Config Example (Copy/Paste)

Example MCP configuration (stdio):

```json
{
  "mcpServers": {
    "jira-focused": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp-by-msw/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "<token>",
        "JIRA_SEVERITY_FIELD_ID": "customfield_12345",
        "JIRA_SEVERITY_JQL_FIELD": "customfield_12345",
        "JIRA_SEVERITY_VALUE_TYPE": "option"
      }
    }
  }
}
```

## Tool Contracts (Short)

### `jira_get_issue`
Input:

- `issueKey`
- `skipComments` (optional, default `false`)
- `loadOnlyLast3Comments` (optional, default `true`; ignored when `skipComments=true`)
- `descriptionFormat` (optional: `plain_text` | `adf`, default `plain_text`)

Output:

- one focused issue object including:
  - `url` (clickable Jira issue link)
  - `description` in the requested format
  - `parent`, `subtasks`, `linkedIssues` (each with own `url`)
  - `comments` (plain text bodies)
  - `commentsMeta` (`mode`, `total`, `returned`)
- use `descriptionFormat=adf` only when exact rich-text structure is required

### `jira_create_issue`
Input:

- required: `projectKey`, `issueType`, `summary`
- optional: `description`, `descriptionFormat`, `fixVersions`, `affectedVersions`, `priority`, `severity`, `status`

Description mode:

- if `descriptionFormat` is omitted or set to `plain_text`, `description` must be a string
- if `descriptionFormat` is `adf`, `description` must be an ADF JSON document (or JSON string of it)
- keep `plain_text` as default for token efficiency; switch to `adf` only for rich formatting preservation

Behavior:

- creates issue
- if `status` is provided, tries transition after creation

### `jira_update_issue`
Input:

- required: `issueKey`
- optional updates: `summary`, `description`, `descriptionFormat`, `fixVersions`, `affectedVersions`, `priority`, `severity`, `status`
- optional flags for returned issue: `skipComments`, `loadOnlyLast3Comments`

Description mode:

- if `descriptionFormat` is omitted or set to `plain_text`, `description` is plain text string
- if `descriptionFormat` is `adf`, `description` must be an ADF JSON document (or JSON string of it)
- use `description: null` to clear description
- keep `plain_text` as default for token efficiency; use `adf` only when rich formatting must be preserved

Behavior:

- updates issue fields via Jira `Edit issue`
- if `status` is provided, applies transition as a second step
- sprint assignment is intentionally **not** done here (Jira ignores sprint updates in many setups via issue edit); use `jira_assign_issue_to_sprint`

### `jira_transition_issue`
Input:

- required: `issueKey`, `toStatus`
- optional flags for returned issue: `skipComments`, `loadOnlyLast3Comments`
- optional: `descriptionFormat` (`plain_text` | `adf`, default `plain_text`)

Behavior:

- applies workflow transition only (dedicated tool)
- returns transition result + focused issue

### `jira_add_comment`
Input:

- `issueKey`
- `body` (plain text)

Behavior:

- adds a Jira comment as ADF (converted from plain text)
- returns created comment in focused shape

### `jira_link_issue`
Input:

- `issueKey`
- `targetIssueKey`
- `relation` (for example `blocks`, `is blocked by`, `relates to`, `duplicates`)
- optional `comment`

Behavior:

- creates issue link using business relation label
- returns normalized relation, link type, direction, and clickable issue URLs (`issueUrl`, `targetIssueUrl`)

### `jira_project_baseline`
Input:

- `projectKey`

Output:

- project info
- issue types (with textual descriptions)
- priorities (id + name + description)
- versions (only unreleased and not archived)
- top assignable users (15, active only), ranked by number of distinct issues assigned in last 60 days:
  - `id` (Jira accountId)
  - `name` (displayName)
  - `email` (can be `null` when hidden by Atlassian privacy settings)
  - `assignedIssuesLast60Days` (ranking score)
- severity context:
  - whether severity is configured
  - configured field id / JQL field / value type
  - allowed severity options with textual descriptions (when Jira metadata provides them)
- field profile for business fields (`summary`, `description`, `fixVersions`, `affectedVersions`, `priority`, `severity`)
- active sprint(s) from Scrum boards, each with contextual description text (goal/state/dates/board)
- workflow per issue type:
  - compact statuses list
  - compact `from -> to` transitions list (business-oriented)
  - coverage metrics (how many statuses had sample issues/transitions)

Notes on workflow transitions:

- Jira does not expose a single small “authoritative transition graph” for a project without pulling large workflow payloads.
- This server infers a compact `from -> to` list by sampling transitions from recently updated issues per status.
- Coverage metrics help you see how complete the inferred graph is for that issue type.

### `jira_project_assignable_users`
Input:

- required: `projectKey`
- required: `maxResults` (1..200)
- optional: `startAt` (pagination offset, default `0`)

Output:

- active assignable users for the project in compact shape:
  - `id` (Jira accountId)
  - `name` (displayName)
  - `email` (can be `null`)
- metadata: `projectKey`, `activeOnly`, `maxResults`, `startAt`
- this tool returns a paged list; use it when the baseline top-15 does not include the user you need

### `jira_list_sprints`
Input:

- required: `projectKey`
- optional: `state` (`active` | `future` | `closed` | `all`, default `active`)
- optional: `boardName` (exact board name filter)
- optional: `maxResultsPerBoard` (1..50, default `20`)

Output:

- sprint list with context-rich fields:
  - `id`, `name`, `state`
  - `description` (human-friendly text)
  - `goal`, `startDate`, `endDate`
  - `board` (`id`, `name`)

### `jira_assign_issue_to_sprint`
Input:

- required: `issueKey`
- choose one target selector:
  - `sprintId` (recommended)
  - `sprintName` (server resolves by name; errors if ambiguous)
- optional disambiguation for `sprintName`: `projectKey`, `boardName`
- optional response controls: `loadIssueAfterAssign`, `skipComments`, `loadOnlyLast3Comments`, `descriptionFormat`

Behavior:

- assigns issue using Jira Agile endpoint: `POST /rest/agile/1.0/sprint/{sprintId}/issue`
- protects against invalid targeting (missing selector, ambiguous sprint name, closed sprint)
- can return refreshed focused issue after successful assignment

### ADF Quick Examples (Short)

Use these only when you need to preserve rich formatting. Otherwise keep `plain_text` for lower token usage.

Get issue in ADF:

```json
{
  "issueKey": "PROJ-123",
  "descriptionFormat": "adf"
}
```

Create issue with ADF description:

```json
{
  "projectKey": "PROJ",
  "issueType": "Task",
  "summary": "Formatted note",
  "descriptionFormat": "adf",
  "description": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Hello from ADF" }]
      }
    ]
  }
}
```

Update issue with ADF description:

```json
{
  "issueKey": "PROJ-123",
  "descriptionFormat": "adf",
  "description": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Updated formatted content" }]
      }
    ]
  }
}
```

### `jira_search_issues`
Input:

- focused filters (`projectKey`, `summaryContains`, `statuses`, `priorities`, versions, severity, etc.)
- optional raw `jql`

Output:

- focused issue list only (no full Jira field payload), including `url` and `parent/subtasks/linkedIssues` with URLs
- `nextPageToken`

### `jira_search_issues_by_jql`
Input:

- required: `jql` (raw JQL)

Output:

- strict, lightweight issue list only:
  - `key`
  - `url`
  - `summary`
  - `fixVersions`
  - `sprints`
  - `assignee`
  - `reporter`
  - `priority`
  - `status`
- hard safety cap: max 50 returned items
- if the query returns more than 50, response includes:
  - `truncated: true`
  - `notice: "Results truncated because results exceeded 50!"`

Why:

- this keeps broad JQL discovery context-safe for the agent
- use `jira_get_issue` to inspect details (including `description`) for specific issue keys

Example input:

```json
{
  "jql": "project = PROJ AND statusCategory != Done ORDER BY updated DESC"
}
```

Example output (<= 50 results):

```json
{
  "jql": "project = PROJ AND statusCategory != Done ORDER BY updated DESC",
  "issues": [
    {
      "key": "PROJ-123",
      "url": "https://your-domain.atlassian.net/browse/PROJ-123",
      "summary": "Checkout fails on Safari",
      "fixVersions": ["2026.02"],
      "sprints": ["Sprint 42"],
      "assignee": "Jane Doe",
      "reporter": "John Smith",
      "priority": "High",
      "status": "In Progress"
    }
  ],
  "truncated": false,
  "notice": null,
  "mode": "enhanced"
}
```

Example output (> 50 results):

```json
{
  "jql": "project = PROJ ORDER BY updated DESC",
  "issues": ["...first 50 issues only..."],
  "truncated": true,
  "notice": "Results truncated because results exceeded 50!",
  "mode": "enhanced"
}
```

If JQL is invalid, Jira returns an API error (for example syntax error), and the tool returns it as an MCP tool error response instead of crashing the server process.

## Notes

- Jira Cloud `description` is stored as ADF.
- Default mode is `plain_text` (for low token cost and simpler prompts).
- You can opt into raw ADF with `descriptionFormat: "adf"` in `jira_get_issue`, `jira_create_issue`, and `jira_update_issue` when preserving rich formatting is required.
- Jira comments are also ADF in Cloud API; server returns/sends plain text at tool boundary.
- Default comment loading mode is last 3 comments to protect LLM context.
- Severity is not a standard Jira system field in many projects; configure custom field mapping in env.
- Search defaults to the enhanced endpoint and falls back to legacy endpoint if needed.

## Troubleshooting

- `401 Unauthorized`: wrong `JIRA_EMAIL` / `JIRA_API_TOKEN`, or wrong `JIRA_BASE_URL`.
- `403 Forbidden`: token user lacks permissions (browse project, transition issues, link issues, etc.).
- Severity updates fail: set `JIRA_SEVERITY_FIELD_ID` and ensure `JIRA_SEVERITY_VALUE_TYPE` matches the field type.
- Link creation fails with “Unknown link relation”: use a relation label that exists in your Jira instance (e.g. `blocks`, `is blocked by`, `relates to`). The server maps these labels to Jira link types.
- Sprint not changing via issue update: this is expected in many Jira setups. Use `jira_assign_issue_to_sprint` (Agile API), not `jira_update_issue`.
