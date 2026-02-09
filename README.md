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
   - Quick way (requires auth):\n
```bash
curl -sS -u \"${JIRA_EMAIL}:${JIRA_API_TOKEN}\" \\\n  \"${JIRA_BASE_URL}/rest/api/3/field\" | head\n```
   - Search the output for a field whose `name` is something like `Severity` and use its `id`.
   - If the field is a select list, use `JIRA_SEVERITY_VALUE_TYPE=option` (default).

## Install

```bash
npm install
cp .env.example .env
# edit .env
npm run build
```

## Environment Variables

Required:

- `JIRA_BASE_URL` (for example `https://your-domain.atlassian.net`)
- Auth option A (recommended for Jira Cloud):
  - `JIRA_EMAIL`
  - `JIRA_API_TOKEN`
- Auth option B:
  - `JIRA_AUTH_HEADER` (full `Authorization` header value, e.g. `Basic ...` or `Bearer ...`)

Optional:

- `JIRA_REQUEST_TIMEOUT_MS` (default `20000`)
- `JIRA_SEVERITY_FIELD_ID` (for example `customfield_12345`)
- `JIRA_SEVERITY_JQL_FIELD` (defaults to severity field id, otherwise `severity`)
- `JIRA_SEVERITY_VALUE_TYPE` (`option` | `string` | `number`, default `option`)

### Verify Auth (Optional)

```bash
curl -sS -u \"${JIRA_EMAIL}:${JIRA_API_TOKEN}\" \\\n  \"${JIRA_BASE_URL}/rest/api/3/myself\" | head\n```

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

## MCP Client Config Example

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
