# Jira Focused MCP Server (Cloud)

MCP server for Jira Cloud with a constrained data abstraction, designed to avoid flooding the LLM context with full Jira payloads.

## Design Goals

- Business-first output: returns only curated fields instead of full Jira payloads.
- Context-safe defaults: comments default to last 3 only.
- Low client complexity: hides Jira REST API details behind stable tools.

## What It Does

This server exposes eight tools:

1. `jira_get_issue`
2. `jira_create_issue`
3. `jira_update_issue`
4. `jira_transition_issue`
5. `jira_add_comment`
6. `jira_link_issue`
7. `jira_project_baseline`
8. `jira_search_issues`

All tools intentionally use a focused issue model:

- `summary`
- `description` (plain text in tool I/O, converted to/from ADF internally)
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

## Configuration: One Place Only

You do **not** need to set Jira credentials in two places.

Pick exactly one:

1. **MCP client config** (recommended when using this as an MCP server)
   - Put all `JIRA_*` variables under the MCP server `env` block.
2. **Local `.env` file** (recommended for local development)
   - Create `.env` next to `package.json`.
   - This server loads `.env` automatically on startup.

If you provide both, the MCP client's `env` usually wins because it is already present in `process.env` and `.env` loading does not override existing variables by default.

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

# Optional (local dev / running from terminal):
cp .env.example .env
# edit .env
```

## Add This Server To An MCP Client (Step-By-Step)

This is a **stdio** MCP server. Most MCP clients need the same 4 things:

1. **Transport**: `STDIO`
2. **Command**: `node`
3. **Arguments**: absolute path to `dist/index.js`
4. **Environment variables**: `JIRA_*` (or use a local `.env`)

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

### Option A (Recommended): Put `JIRA_*` In The MCP Client

This is the simplest and most reliable setup (no `.env` needed).

- `command`: `node`
- `args`: `["/absolute/path/to/jira-mcp-by-msw/dist/index.js"]`
- `env`: add your `JIRA_*` variables
- `workingDirectory`: optional (can be empty)

If your client has a single “command line” field instead of `command` + `args`, use:

- `node /absolute/path/to/jira-mcp-by-msw/dist/index.js`

### Option B: Use A Local `.env` File

This is convenient for local dev and CLI runs.

1. Create `.env` next to `package.json`:
   - `cp .env.example .env`
2. In the MCP client, set:
   - `command`: `node`
   - `args`: `["/absolute/path/to/jira-mcp-by-msw/dist/index.js"]`
   - `workingDirectory`: `/absolute/path/to/jira-mcp-by-msw`
   - `env`: leave empty (recommended, to avoid duplication)

This repo uses `dotenv/config`, so it loads `.env` automatically on startup.

### Codex App (UI) Example (Idioto-Odporne)

In Codex App, when you add a “custom MCP” server:

1. Select `STDIO`.
2. Fill the fields like this:
   - **Name**: `jira-focused` (any name is fine)
   - **Command to launch**: `node`
   - **Arguments**: `/absolute/path/to/jira-mcp-by-msw/dist/index.js`
   - **Environment variables** (recommended): add `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (and optional `JIRA_SEVERITY_*`)
   - **Working directory**: leave empty (if you used env vars) or set it to `/absolute/path/to/jira-mcp-by-msw` (if you want `.env` loading)
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

Output:

- one focused issue object including:
  - `parent`, `subtasks`, `linkedIssues`
  - `comments` (plain text bodies)
  - `commentsMeta` (`mode`, `total`, `returned`)

### `jira_create_issue`
Input:

- required: `projectKey`, `issueType`, `summary`
- optional: `description`, `fixVersions`, `affectedVersions`, `priority`, `severity`, `status`

Behavior:

- creates issue
- if `status` is provided, tries transition after creation

### `jira_update_issue`
Input:

- required: `issueKey`
- optional updates: `summary`, `description`, `fixVersions`, `affectedVersions`, `priority`, `severity`, `status`
- optional flags for returned issue: `skipComments`, `loadOnlyLast3Comments`

Behavior:

- updates issue fields via Jira `Edit issue`
- if `status` is provided, applies transition as a second step

### `jira_transition_issue`
Input:

- required: `issueKey`, `toStatus`
- optional flags for returned issue: `skipComments`, `loadOnlyLast3Comments`

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
- returns normalized relation, link type and direction

### `jira_project_baseline`
Input:

- `projectKey`

Output:

- project info
- issue types
- priorities
- versions
- field profile for business fields (`summary`, `description`, `fixVersions`, `affectedVersions`, `priority`, `severity`)
- active sprint(s) from Scrum boards
- workflow per issue type:
  - compact statuses list
  - compact `from -> to` transitions list (business-oriented)
  - coverage metrics (how many statuses had sample issues/transitions)

Notes on workflow transitions:

- Jira does not expose a single small “authoritative transition graph” for a project without pulling large workflow payloads.
- This server infers a compact `from -> to` list by sampling transitions from recently updated issues per status.
- Coverage metrics help you see how complete the inferred graph is for that issue type.

### `jira_search_issues`
Input:

- focused filters (`projectKey`, `summaryContains`, `statuses`, `priorities`, versions, severity, etc.)
- optional raw `jql`

Output:

- focused issue list only (no full Jira field payload), including `parent/subtasks/linkedIssues`
- `nextPageToken`

## Notes

- Jira Cloud `description` is stored as ADF; this server abstracts it to plain text in tool-level I/O.
- Jira comments are also ADF in Cloud API; server returns/sends plain text at tool boundary.
- Default comment loading mode is last 3 comments to protect LLM context.
- Severity is not a standard Jira system field in many projects; configure custom field mapping in env.
- Search defaults to the enhanced endpoint and falls back to legacy endpoint if needed.

## Troubleshooting

- `401 Unauthorized`: wrong `JIRA_EMAIL` / `JIRA_API_TOKEN`, or wrong `JIRA_BASE_URL`.
- `403 Forbidden`: token user lacks permissions (browse project, transition issues, link issues, etc.).
- Severity updates fail: set `JIRA_SEVERITY_FIELD_ID` and ensure `JIRA_SEVERITY_VALUE_TYPE` matches the field type.
- Link creation fails with “Unknown link relation”: use a relation label that exists in your Jira instance (e.g. `blocks`, `is blocked by`, `relates to`). The server maps these labels to Jira link types.
