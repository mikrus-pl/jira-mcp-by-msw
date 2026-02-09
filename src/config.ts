export type SeverityValueType = "option" | "string" | "number";

export interface JiraConfig {
  baseUrl: string;
  authHeader: string;
  requestTimeoutMs: number;
  severityFieldId?: string;
  severityJqlField: string;
  severityValueType: SeverityValueType;
}

export function loadJiraConfig(env: NodeJS.ProcessEnv = process.env): JiraConfig {
  const baseUrl = normalizeBaseUrl(readRequired(env.JIRA_BASE_URL, "JIRA_BASE_URL"));

  let authHeader = env.JIRA_AUTH_HEADER?.trim();
  if (!authHeader) {
    const email = readRequired(env.JIRA_EMAIL, "JIRA_EMAIL");
    const token = readRequired(env.JIRA_API_TOKEN, "JIRA_API_TOKEN");
    authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  }

  const timeoutRaw = env.JIRA_REQUEST_TIMEOUT_MS?.trim();
  const requestTimeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 20_000;
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("JIRA_REQUEST_TIMEOUT_MS must be a positive integer.");
  }

  const severityFieldId = normalizeOptional(env.JIRA_SEVERITY_FIELD_ID);
  const severityJqlField =
    normalizeOptional(env.JIRA_SEVERITY_JQL_FIELD) ?? severityFieldId ?? "severity";
  const severityValueType = parseSeverityValueType(env.JIRA_SEVERITY_VALUE_TYPE);

  return {
    baseUrl,
    authHeader,
    requestTimeoutMs,
    severityJqlField,
    severityValueType,
    ...(severityFieldId ? { severityFieldId } : {})
  };
}

function parseSeverityValueType(input: string | undefined): SeverityValueType {
  const normalized = input?.trim().toLowerCase();
  if (!normalized) {
    return "option";
  }

  if (normalized === "option" || normalized === "string" || normalized === "number") {
    return normalized;
  }

  throw new Error("JIRA_SEVERITY_VALUE_TYPE must be one of: option, string, number.");
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("JIRA_BASE_URL must be a valid URL, e.g. https://your-domain.atlassian.net");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("JIRA_BASE_URL must use HTTPS.");
  }

  return parsed.toString().replace(/\/+$/, "");
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readRequired(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return trimmed;
}
