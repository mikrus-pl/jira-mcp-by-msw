import { adfToPlainText, plainTextToAdf } from "./adf.js";
import type { JiraConfig } from "./config.js";
import type {
  AddCommentInput,
  AddCommentResult,
  AssignableUser,
  AssignIssueToSprintInput,
  AssignIssueToSprintResult,
  BusinessFieldName,
  CompactIssueRef,
  CreateIssueInput,
  CreateIssueResult,
  DescriptionFormat,
  FocusedIssue,
  IssueComment,
  IssueCommentsMeta,
  IssueDescription,
  IssueReadOptions,
  IssueRef,
  IssueTransitionResult,
  JqlIssueListItem,
  ListSprintsInput,
  ListSprintsResult,
  ListProjectAssignableUsersInput,
  ListProjectAssignableUsersResult,
  LinkIssueInput,
  LinkIssueResult,
  ProjectBaseline,
  SearchIssuesByJqlInput,
  SearchIssuesByJqlResult,
  SearchIssuesInput,
  SearchIssuesResult,
  SprintStateFilter,
  TransitionIssueInput,
  TransitionIssueResult,
  UpdateIssueInput,
  UpdateIssueResult
} from "./types.js";

const BUSINESS_FIELDS: BusinessFieldName[] = [
  "summary",
  "description",
  "fixVersions",
  "affectedVersions",
  "priority",
  "severity"
];

const JQL_RESULTS_TRUNCATED_NOTICE = "Results truncated because results exceeded 50!";

interface JiraIssueResponse {
  key: string;
  fields: Record<string, unknown>;
}

interface JiraProjectResponse {
  id?: string;
  key?: string;
  name?: string;
  issueTypes?: Array<{
    id?: string;
    name?: string;
    description?: string;
    subtask?: boolean;
  }>;
}

interface JiraVersion {
  id?: string;
  name?: string;
  released?: boolean;
  archived?: boolean;
  releaseDate?: string;
}

interface JiraTransition {
  id?: string;
  name?: string;
  to?: {
    id?: string;
    name?: string;
  };
}

interface JiraTransitionResponse {
  transitions?: JiraTransition[];
}

interface JiraBoardSearchResponse {
  values?: Array<{
    id?: number;
    name?: string;
    type?: string;
  }>;
}

interface JiraBoardResponse {
  id?: number;
  name?: string;
  type?: string;
}

interface JiraSprintSearchResponse {
  values?: Array<{
    id?: number;
    name?: string;
    state?: string;
    goal?: string;
    startDate?: string;
    endDate?: string;
  }>;
}

interface JiraSprintResponse {
  id?: number;
  name?: string;
  state?: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  originBoardId?: number;
  boardId?: number;
}

interface JiraProjectStatusesEntry {
  issueType?: {
    id?: string;
    name?: string;
  };
  statuses?: Array<{
    id?: string;
    name?: string;
    statusCategory?: {
      name?: string;
    };
  }>;
}

interface JiraEnhancedSearchResponse {
  issues?: JiraIssueResponse[];
  nextPageToken?: string;
}

interface JiraLegacySearchResponse {
  issues?: JiraIssueResponse[];
  total?: number;
  startAt?: number;
}

interface JiraIssueChangelogItem {
  field?: string;
  fieldId?: string;
  to?: string;
}

interface JiraIssueChangelogHistory {
  created?: string;
  items?: JiraIssueChangelogItem[];
}

interface JiraIssueWithChangelogResponse extends JiraIssueResponse {
  changelog?: {
    histories?: JiraIssueChangelogHistory[];
  };
}

interface JiraLegacySearchWithChangelogResponse {
  issues?: JiraIssueWithChangelogResponse[];
  total?: number;
  startAt?: number;
}

interface JiraCommentResponse {
  id?: string;
  body?: unknown;
  created?: string;
  updated?: string;
  author?: {
    accountId?: string;
    displayName?: string;
  };
}

interface JiraCommentPageResponse {
  comments?: JiraCommentResponse[];
  total?: number;
}

interface JiraPriority {
  id?: string;
  name?: string;
  description?: string;
}

interface JiraPrioritySearchResponse {
  values?: JiraPriority[];
}

interface JiraUser {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
}

interface JiraMetaField {
  required?: boolean;
  allowedValues?: unknown[];
}

interface JiraCreateMetaResponse {
  projects?: Array<{
    key?: string;
    issuetypes?: Array<{
      id?: string;
      name?: string;
      fields?: Record<string, JiraMetaField>;
    }>;
  }>;
}

interface JiraIssueLinkType {
  id?: string;
  name?: string;
  inward?: string;
  outward?: string;
}

interface JiraIssueLinkTypeResponse {
  issueLinkTypes?: JiraIssueLinkType[];
}

interface WorkflowIssueTypeStatus {
  issueType: {
    id: string;
    name: string;
  };
  statuses: Array<{
    id: string;
    name: string;
    category: string | null;
  }>;
}

export class JiraApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

export class JiraClient {
  constructor(private readonly config: JiraConfig) {}

  async getIssue(issueKey: string, options: IssueReadOptions = {}): Promise<FocusedIssue> {
    const query = new URLSearchParams({
      fields: this.getIssueFields().join(","),
      fieldsByKeys: "false"
    });

    const issue = await this.request<JiraIssueResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?${query.toString()}`
    );

    const commentsContext = await this.getIssueComments(issueKey, options);
    return this.toFocusedIssue(
      issue,
      commentsContext.comments,
      commentsContext.meta,
      options.descriptionFormat
    );
  }

  async createIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
    const issueTypeId = await this.resolveIssueTypeId(input.projectKey, input.issueType);
    const fixVersionIds = await this.resolveVersionIds(input.projectKey, input.fixVersions);
    const affectedVersionIds = await this.resolveVersionIds(input.projectKey, input.affectedVersions);

    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      issuetype: { id: issueTypeId },
      summary: input.summary
    };

    if (input.description !== undefined) {
      fields.description = this.toJiraDescription(input.description, input.descriptionFormat);
    }

    if (fixVersionIds.length > 0) {
      fields.fixVersions = fixVersionIds.map((id) => ({ id }));
    }

    if (affectedVersionIds.length > 0) {
      fields.versions = affectedVersionIds.map((id) => ({ id }));
    }

    const priorityPayload = this.buildPriorityPayload(input.priority);
    if (priorityPayload) {
      fields.priority = priorityPayload;
    }

    const severityPayload = this.buildSeverityPayload(input.severity);
    if (severityPayload !== undefined) {
      if (!this.config.severityFieldId) {
        throw new Error(
          "Cannot set severity: configure JIRA_SEVERITY_FIELD_ID (for example customfield_12345)."
        );
      }
      fields[this.config.severityFieldId] = severityPayload;
    }

    const created = await this.request<{ key: string }>("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({ fields })
    });

    let transition: IssueTransitionResult | undefined;
    if (input.status) {
      transition = await this.tryTransitionIssue(created.key, input.status);
    }

    const issue = await this.getIssue(created.key, {
      ...(input.descriptionFormat ? { descriptionFormat: input.descriptionFormat } : {})
    });
    return {
      issue,
      ...(transition ? { transition } : {})
    };
  }

  async updateIssue(input: UpdateIssueInput): Promise<UpdateIssueResult> {
    const fields: Record<string, unknown> = {};
    const issueKey = input.issueKey;

    if (input.summary !== undefined) {
      const summary = input.summary.trim();
      if (!summary) {
        throw new Error("summary cannot be empty when provided.");
      }
      fields.summary = summary;
    }

    if (input.description !== undefined) {
      fields.description =
        input.description === null
          ? null
          : this.toJiraDescription(input.description, input.descriptionFormat);
    }

    const needsProjectKey =
      input.fixVersions !== undefined || input.affectedVersions !== undefined;

    let projectKey: string | undefined;
    if (needsProjectKey) {
      projectKey = await this.getIssueProjectKey(issueKey);
    }

    if (input.fixVersions !== undefined) {
      if (!projectKey) {
        throw new Error("Cannot update fixVersions: issue project key is unavailable.");
      }
      const fixVersionIds = await this.resolveVersionIds(projectKey, input.fixVersions);
      fields.fixVersions = fixVersionIds.map((id) => ({ id }));
    }

    if (input.affectedVersions !== undefined) {
      if (!projectKey) {
        throw new Error("Cannot update affectedVersions: issue project key is unavailable.");
      }
      const affectedVersionIds = await this.resolveVersionIds(projectKey, input.affectedVersions);
      fields.versions = affectedVersionIds.map((id) => ({ id }));
    }

    const priorityUpdateValue = this.buildPriorityUpdateValue(input.priority);
    if (priorityUpdateValue !== undefined) {
      fields.priority = priorityUpdateValue;
    }

    const severityUpdateValue = this.buildSeverityUpdateValue(input.severity);
    if (severityUpdateValue !== undefined) {
      if (!this.config.severityFieldId) {
        throw new Error(
          "Cannot update severity: configure JIRA_SEVERITY_FIELD_ID (for example customfield_12345)."
        );
      }
      fields[this.config.severityFieldId] = severityUpdateValue;
    }

    if (Object.keys(fields).length === 0 && !input.status) {
      throw new Error("No changes requested. Provide at least one field to update or status.");
    }

    if (Object.keys(fields).length > 0) {
      const query = new URLSearchParams({ returnIssue: "false" });
      if (typeof input.notifyUsers === "boolean") {
        query.set("notifyUsers", String(input.notifyUsers));
      }

      await this.request<void>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}?${query.toString()}`,
        {
          method: "PUT",
          body: JSON.stringify({ fields })
        }
      );
    }

    let transition: IssueTransitionResult | undefined;
    if (input.status) {
      transition = await this.tryTransitionIssue(issueKey, input.status);
    }

    const issueReadOptions: IssueReadOptions = {
      ...(typeof input.skipComments === "boolean"
        ? { skipComments: input.skipComments }
        : {}),
      ...(typeof input.loadOnlyLast3Comments === "boolean"
        ? { loadOnlyLast3Comments: input.loadOnlyLast3Comments }
        : {}),
      ...(input.descriptionFormat ? { descriptionFormat: input.descriptionFormat } : {})
    };

    const issue = await this.getIssue(issueKey, issueReadOptions);

    return {
      issue,
      ...(transition ? { transition } : {})
    };
  }

  async transitionIssue(input: TransitionIssueInput): Promise<TransitionIssueResult> {
    const transition = await this.tryTransitionIssue(input.issueKey, input.toStatus);

    const issue = await this.getIssue(input.issueKey, {
      ...(typeof input.skipComments === "boolean"
        ? { skipComments: input.skipComments }
        : {}),
      ...(typeof input.loadOnlyLast3Comments === "boolean"
        ? { loadOnlyLast3Comments: input.loadOnlyLast3Comments }
        : {}),
      ...(input.descriptionFormat ? { descriptionFormat: input.descriptionFormat } : {})
    });

    return {
      issue,
      transition
    };
  }

  async addComment(input: AddCommentInput): Promise<AddCommentResult> {
    const issueKey = input.issueKey;
    const body = input.body.trim();

    if (!body) {
      throw new Error("Comment body cannot be empty.");
    }

    const comment = await this.request<JiraCommentResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: "POST",
        body: JSON.stringify({
          body: plainTextToAdf(body)
        })
      }
    );

    return {
      issueKey,
      comment: this.toIssueComment(comment)
    };
  }

  async linkIssue(input: LinkIssueInput): Promise<LinkIssueResult> {
    const issueKey = input.issueKey.trim();
    const targetIssueKey = input.targetIssueKey.trim();
    const relation = input.relation.trim();

    if (!issueKey || !targetIssueKey || !relation) {
      throw new Error("issueKey, targetIssueKey and relation are required.");
    }

    const linkTypes = await this.fetchIssueLinkTypes();
    const resolved = this.resolveIssueLinkPayload(issueKey, targetIssueKey, relation, linkTypes);

    const body: Record<string, unknown> = {
      type: {
        name: resolved.linkType
      },
      inwardIssue: {
        key: resolved.inwardIssueKey
      },
      outwardIssue: {
        key: resolved.outwardIssueKey
      }
    };

    const commentBody = input.comment?.trim();
    if (commentBody) {
      body.comment = {
        body: plainTextToAdf(commentBody)
      };
    }

    await this.request<void>("/rest/api/3/issueLink", {
      method: "POST",
      body: JSON.stringify(body)
    });

    return {
      issueKey,
      targetIssueKey,
      relation: resolved.relation,
      linkType: resolved.linkType,
      direction: resolved.direction
    };
  }

  async searchIssues(input: SearchIssuesInput): Promise<SearchIssuesResult> {
    const jql = this.buildJql(input);
    const issueFields = this.getIssueFields();

    try {
      const body: Record<string, unknown> = {
        jql,
        maxResults: input.maxResults ?? 25,
        fields: issueFields,
        fieldsByKeys: false
      };

      if (input.nextPageToken) {
        body.nextPageToken = input.nextPageToken;
      }

      const response = await this.request<JiraEnhancedSearchResponse>("/rest/api/3/search/jql", {
        method: "POST",
        body: JSON.stringify(body)
      });

      const issues = (response.issues ?? []).map((issue) => this.toFocusedIssue(issue));

      return {
        jql,
        issues,
        nextPageToken: response.nextPageToken ?? null,
        mode: "enhanced"
      };
    } catch (error) {
      if (!(error instanceof JiraApiError) || error.status !== 404) {
        throw error;
      }

      const startAt = parseNextPageToken(input.nextPageToken);

      const response = await this.request<JiraLegacySearchResponse>("/rest/api/3/search", {
        method: "POST",
        body: JSON.stringify({
          jql,
          maxResults: input.maxResults ?? 25,
          startAt,
          fields: issueFields,
          fieldsByKeys: false
        })
      });

      const issues = (response.issues ?? []).map((issue) => this.toFocusedIssue(issue));
      const nextStart = (response.startAt ?? 0) + issues.length;
      const total = response.total ?? 0;

      return {
        jql,
        issues,
        nextPageToken: nextStart < total ? String(nextStart) : null,
        mode: "legacy"
      };
    }
  }

  async searchIssuesByJql(input: SearchIssuesByJqlInput): Promise<SearchIssuesByJqlResult> {
    const jql = this.buildStrictJql(input.jql);
    const issueFields = this.getIssueListFields();

    try {
      const response = await this.request<JiraEnhancedSearchResponse>("/rest/api/3/search/jql", {
        method: "POST",
        body: JSON.stringify({
          jql,
          maxResults: 51,
          fields: issueFields,
          fieldsByKeys: false
        })
      });

      const rawIssues = response.issues ?? [];
      const truncated = rawIssues.length > 50 || Boolean(response.nextPageToken);
      const issues = rawIssues.slice(0, 50).map((issue) => this.toJqlIssueListItem(issue));

      return {
        jql,
        issues,
        truncated,
        notice: truncated ? JQL_RESULTS_TRUNCATED_NOTICE : null,
        mode: "enhanced"
      };
    } catch (error) {
      if (!(error instanceof JiraApiError) || error.status !== 404) {
        throw error;
      }

      const response = await this.request<JiraLegacySearchResponse>("/rest/api/3/search", {
        method: "POST",
        body: JSON.stringify({
          jql,
          maxResults: 51,
          startAt: 0,
          fields: issueFields,
          fieldsByKeys: false
        })
      });

      const rawIssues = response.issues ?? [];
      const truncated = (response.total ?? 0) > 50 || rawIssues.length > 50;
      const issues = rawIssues.slice(0, 50).map((issue) => this.toJqlIssueListItem(issue));

      return {
        jql,
        issues,
        truncated,
        notice: truncated ? JQL_RESULTS_TRUNCATED_NOTICE : null,
        mode: "legacy"
      };
    }
  }

  async listSprints(input: ListSprintsInput): Promise<ListSprintsResult> {
    const projectKey = input.projectKey.trim();
    if (!projectKey) {
      throw new Error("projectKey cannot be empty.");
    }

    const state = this.normalizeSprintStateFilter(input.state);
    const boardName = this.normalizeString(input.boardName) ?? null;
    const maxResultsPerBoard = this.parseMaxResultsPerBoard(input.maxResultsPerBoard);

    const boards = await this.fetchScrumBoards(projectKey, boardName ?? undefined);
    if (boards.length === 0) {
      return {
        projectKey,
        filter: {
          state,
          boardName,
          maxResultsPerBoard
        },
        sprints: []
      };
    }

    const sprints = await this.fetchSprintsFromBoards(boards, state, maxResultsPerBoard);

    return {
      projectKey,
      filter: {
        state,
        boardName,
        maxResultsPerBoard
      },
      sprints
    };
  }

  async listProjectAssignableUsers(
    input: ListProjectAssignableUsersInput
  ): Promise<ListProjectAssignableUsersResult> {
    const projectKey = input.projectKey.trim();
    if (!projectKey) {
      throw new Error("projectKey cannot be empty.");
    }

    const maxResults = this.parseAssignableUsersMaxResults(input.maxResults);
    const startAt = this.parseAssignableUsersStartAt(input.startAt);
    const users = await this.fetchProjectAssignableUsers(projectKey, maxResults, startAt);

    return {
      projectKey,
      activeOnly: true,
      maxResults,
      startAt,
      users
    };
  }

  async assignIssueToSprint(input: AssignIssueToSprintInput): Promise<AssignIssueToSprintResult> {
    const issueKey = input.issueKey.trim();
    if (!issueKey) {
      throw new Error("issueKey cannot be empty.");
    }

    const sprint = await this.resolveSprintForAssignment(input, issueKey);
    const normalizedState = sprint.state.trim().toLowerCase();
    if (normalizedState === "closed") {
      throw new Error(`Cannot assign issue to closed sprint ${sprint.id} (${sprint.name}).`);
    }

    await this.request<void>(`/rest/agile/1.0/sprint/${sprint.id}/issue`, {
      method: "POST",
      body: JSON.stringify({
        issues: [issueKey]
      })
    });

    const loadIssueAfterAssign = input.loadIssueAfterAssign ?? true;
    if (!loadIssueAfterAssign) {
      return {
        issueKey,
        sprint
      };
    }

    const issue = await this.getIssue(issueKey, {
      ...(typeof input.skipComments === "boolean" ? { skipComments: input.skipComments } : {}),
      ...(typeof input.loadOnlyLast3Comments === "boolean"
        ? { loadOnlyLast3Comments: input.loadOnlyLast3Comments }
        : {}),
      ...(input.descriptionFormat ? { descriptionFormat: input.descriptionFormat } : {})
    });

    return {
      issueKey,
      sprint,
      issue
    };
  }

  async getProjectBaseline(projectKey: string): Promise<ProjectBaseline> {
    const project = await this.request<JiraProjectResponse>(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}`
    );

    const projectId = this.requireString(project.id, "Missing project id in Jira response.");
    const normalizedProjectKey = this.requireString(
      project.key,
      "Missing project key in Jira response."
    );
    const projectName = this.requireString(project.name, "Missing project name in Jira response.");

    const notes: string[] = [];

    const issueTypes = (project.issueTypes ?? [])
      .map((issueType) => {
        if (!issueType.id || !issueType.name) {
          return null;
        }

        return {
          id: issueType.id,
          name: issueType.name,
          description: issueType.description?.trim() ?? "",
          subtask: issueType.subtask ?? false
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    let priorities: ProjectBaseline["priorities"] = [];
    try {
      priorities = await this.fetchPriorities(projectId);
    } catch (error) {
      notes.push(`Priorities lookup unavailable: ${toErrorMessage(error)}`);
    }

    let versions: ProjectBaseline["versions"] = [];
    try {
      versions = await this.fetchProjectVersions(projectKey);
    } catch (error) {
      notes.push(`Versions lookup unavailable: ${toErrorMessage(error)}`);
    }

    let assignableUsers: ProjectBaseline["assignableUsers"] = [];
    try {
      const topAssignableUsers = await this.fetchTopAssignableUsersByRecentAssignments(projectKey, {
        days: 60,
        limit: 15
      });
      assignableUsers = topAssignableUsers.users;
      if (topAssignableUsers.truncated) {
        notes.push(
          "Assignable users ranking used a bounded scan window for recent issue history; ranking may be partial."
        );
      }
    } catch (error) {
      notes.push(`Assignable users lookup unavailable: ${toErrorMessage(error)}`);
    }

    let workflowIssueTypeStatuses: WorkflowIssueTypeStatus[] = [];
    try {
      const statuses = await this.request<JiraProjectStatusesEntry[]>(
        `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`
      );

      workflowIssueTypeStatuses = statuses
        .map((entry) => {
          const issueTypeId = entry.issueType?.id;
          const issueTypeName = entry.issueType?.name;

          if (!issueTypeId || !issueTypeName) {
            return null;
          }

          const mappedStatuses = (entry.statuses ?? [])
            .map((status) => {
              if (!status.id || !status.name) {
                return null;
              }

              return {
                id: status.id,
                name: status.name,
                category: status.statusCategory?.name ?? null
              };
            })
            .filter((value): value is NonNullable<typeof value> => Boolean(value));

          return {
            issueType: {
              id: issueTypeId,
              name: issueTypeName
            },
            statuses: mappedStatuses
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value));
    } catch (error) {
      notes.push(`Workflow status lookup unavailable: ${toErrorMessage(error)}`);
    }

    let fieldProfile: ProjectBaseline["fieldProfile"] = [];
    try {
      fieldProfile = await this.buildFieldProfile(projectKey, issueTypes, priorities, versions);
    } catch (error) {
      notes.push(`Field profile lookup unavailable: ${toErrorMessage(error)}`);
      fieldProfile = issueTypes.map((issueType) => ({
        issueType: {
          id: issueType.id,
          name: issueType.name
        },
        fields: BUSINESS_FIELDS.map((field) => ({
          field,
          required: field === "summary",
          supported: field !== "severity" || Boolean(this.config.severityFieldId),
          allowedValues: this.defaultAllowedValues(field, priorities, versions)
        }))
      }));
    }

    let issueTypeFlows: ProjectBaseline["workflow"]["issueTypeFlows"] = [];
    try {
      issueTypeFlows = await this.buildIssueTypeFlows(projectKey, workflowIssueTypeStatuses);
    } catch (error) {
      notes.push(`Workflow transitions lookup unavailable: ${toErrorMessage(error)}`);
    }

    let activeSprints: ProjectBaseline["activeSprints"] = [];
    try {
      activeSprints = await this.fetchActiveSprints(projectKey);
    } catch (error) {
      notes.push(`Active sprint lookup unavailable: ${toErrorMessage(error)}`);
    }

    let severity: ProjectBaseline["severity"] = this.defaultSeverityContext();
    try {
      severity = await this.buildSeverityContext(projectKey);
    } catch (error) {
      notes.push(`Severity lookup unavailable: ${toErrorMessage(error)}`);
    }

    return {
      project: {
        id: projectId,
        key: normalizedProjectKey,
        name: projectName
      },
      issueTypes,
      priorities,
      versions,
      assignableUsers,
      activeSprints,
      severity,
      fieldProfile,
      workflow: {
        issueTypeFlows
      },
      notes
    };
  }

  private async buildFieldProfile(
    projectKey: string,
    issueTypes: ProjectBaseline["issueTypes"],
    priorities: ProjectBaseline["priorities"],
    versions: ProjectBaseline["versions"]
  ): Promise<ProjectBaseline["fieldProfile"]> {
    const metaByIssueType = await this.fetchCreateMetaFieldMap(projectKey);

    return issueTypes.map((issueType) => {
      const fieldsMeta = metaByIssueType.get(issueType.id);

      return {
        issueType: {
          id: issueType.id,
          name: issueType.name
        },
        fields: BUSINESS_FIELDS.map((field) => {
          const jiraFieldKey = this.getJiraFieldKeyForBusinessField(field);
          const metaField = jiraFieldKey ? fieldsMeta?.[jiraFieldKey] : undefined;

          const defaultRequired = field === "summary";
          const defaultSupported = field !== "severity" || Boolean(this.config.severityFieldId);
          const defaultAllowed = this.defaultAllowedValues(field, priorities, versions);
          const allowedFromMeta = this.extractAllowedValues(metaField?.allowedValues);

          return {
            field,
            required: metaField?.required ?? defaultRequired,
            supported: Boolean(metaField) || defaultSupported,
            allowedValues: allowedFromMeta.length > 0 ? allowedFromMeta : defaultAllowed
          };
        })
      };
    });
  }

  private async fetchCreateMetaFieldMap(
    projectKey: string
  ): Promise<Map<string, Record<string, JiraMetaField>>> {
    const query = new URLSearchParams({
      projectKeys: projectKey,
      expand: "projects.issuetypes.fields"
    });

    const response = await this.request<JiraCreateMetaResponse>(
      `/rest/api/3/issue/createmeta?${query.toString()}`
    );

    const projectMeta = (response.projects ?? []).find(
      (project) => normalizeLabelForMatch(project.key) === normalizeLabelForMatch(projectKey)
    );

    if (!projectMeta) {
      return new Map();
    }

    const byIssueType = new Map<string, Record<string, JiraMetaField>>();

    for (const issueType of projectMeta.issuetypes ?? []) {
      const issueTypeId = this.normalizeString(issueType.id);
      if (!issueTypeId) {
        continue;
      }

      byIssueType.set(issueTypeId, issueType.fields ?? {});
    }

    return byIssueType;
  }

  private async buildIssueTypeFlows(
    projectKey: string,
    issueTypeStatuses: WorkflowIssueTypeStatus[]
  ): Promise<ProjectBaseline["workflow"]["issueTypeFlows"]> {
    const flows: ProjectBaseline["workflow"]["issueTypeFlows"] = [];

    for (const issueTypeStatus of issueTypeStatuses) {
      const statuses = issueTypeStatus.statuses;
      const recentIssuesByStatus = await this.fetchRecentIssueKeysByStatus(
        projectKey,
        issueTypeStatus.issueType.name
      );

      const transitionMap = new Map<string, { from: string; to: string; transition: string }>();
      let statusesWithSample = 0;
      let statusesWithTransitions = 0;

      for (const status of statuses) {
        const statusKey = normalizeLabelForMatch(status.name);
        const sampleIssueKey = recentIssuesByStatus.get(statusKey);

        if (!sampleIssueKey) {
          continue;
        }

        statusesWithSample += 1;

        let transitionsAddedForStatus = 0;

        try {
          const transitions = await this.listIssueTransitions(sampleIssueKey);

          for (const transition of transitions) {
            const toStatus = this.normalizeString(transition.to?.name);
            const transitionName = this.normalizeString(transition.name) ?? toStatus;

            if (!toStatus || !transitionName) {
              continue;
            }

            const transitionKey = `${status.name}=>${toStatus}=>${transitionName}`;
            if (!transitionMap.has(transitionKey)) {
              transitionMap.set(transitionKey, {
                from: status.name,
                to: toStatus,
                transition: transitionName
              });
              transitionsAddedForStatus += 1;
            }
          }
        } catch {
          continue;
        }

        if (transitionsAddedForStatus > 0) {
          statusesWithTransitions += 1;
        }
      }

      const transitions = [...transitionMap.values()].sort((left, right) => {
        if (left.from !== right.from) {
          return left.from.localeCompare(right.from);
        }

        if (left.to !== right.to) {
          return left.to.localeCompare(right.to);
        }

        return left.transition.localeCompare(right.transition);
      });

      flows.push({
        issueType: issueTypeStatus.issueType,
        statuses,
        transitions,
        coverage: {
          statusesTotal: statuses.length,
          statusesWithSample,
          statusesWithTransitions
        }
      });
    }

    return flows;
  }

  private async fetchRecentIssueKeysByStatus(
    projectKey: string,
    issueTypeName: string
  ): Promise<Map<string, string>> {
    const jql = [
      `project = ${this.quoteJqlLiteral(projectKey)}`,
      `issuetype = ${this.quoteJqlLiteral(issueTypeName)}`,
      "ORDER BY updated DESC"
    ].join(" AND ");

    const response = await this.request<JiraLegacySearchResponse>("/rest/api/3/search", {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults: 100,
        fields: ["status"],
        fieldsByKeys: false
      })
    });

    const byStatus = new Map<string, string>();

    for (const issue of response.issues ?? []) {
      const statusName = this.normalizeString(
        (issue.fields.status as Record<string, unknown> | undefined)?.name
      );

      if (!statusName) {
        continue;
      }

      const statusKey = normalizeLabelForMatch(statusName);
      if (!byStatus.has(statusKey)) {
        byStatus.set(statusKey, issue.key);
      }
    }

    return byStatus;
  }

  private async listIssueTransitions(issueKey: string): Promise<JiraTransition[]> {
    const response = await this.request<JiraTransitionResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
    );

    return response.transitions ?? [];
  }

  private async fetchPriorities(projectId: string): Promise<ProjectBaseline["priorities"]> {
    try {
      const query = new URLSearchParams({
        maxResults: "100",
        projectId
      });

      const response = await this.request<JiraPrioritySearchResponse>(
        `/rest/api/3/priority/search?${query.toString()}`
      );

      const priorities = (response.values ?? [])
        .map((priority) => {
          if (!priority.id || !priority.name) {
            return null;
          }

          return {
            id: priority.id,
            name: priority.name,
            description: priority.description?.trim() ?? ""
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value));

      if (priorities.length > 0) {
        return priorities;
      }
    } catch {
      // fallback below
    }

    const fallback = await this.request<JiraPriority[]>("/rest/api/3/priority");

    return fallback
      .map((priority) => {
        if (!priority.id || !priority.name) {
          return null;
        }

        return {
          id: priority.id,
          name: priority.name,
          description: priority.description?.trim() ?? ""
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
  }

  private async fetchProjectVersions(projectKey: string): Promise<ProjectBaseline["versions"]> {
    const versions = await this.request<JiraVersion[]>(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`
    );

    return versions
      .map((version) => {
        if (!version.id || !version.name) {
          return null;
        }

        const released = version.released ?? false;
        const archived = version.archived ?? false;
        if (released || archived) {
          return null;
        }

        return {
          id: version.id,
          name: version.name,
          released,
          archived,
          releaseDate: version.releaseDate ?? null
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
  }

  private parseAssignableUsersMaxResults(input: number): number {
    if (!Number.isInteger(input) || input < 1 || input > 200) {
      throw new Error("maxResults must be an integer between 1 and 200.");
    }

    return input;
  }

  private parseAssignableUsersStartAt(input: number | undefined): number {
    if (input === undefined) {
      return 0;
    }

    if (!Number.isInteger(input) || input < 0) {
      throw new Error("startAt must be an integer greater than or equal to 0.");
    }

    return input;
  }

  private async fetchProjectAssignableUsers(
    projectKey: string,
    maxResults: number,
    startAt: number
  ): Promise<AssignableUser[]> {
    const users = await this.fetchProjectAssignableUsersPage(projectKey, maxResults, startAt);
    return this.toActiveAssignableUsers(users);
  }

  private async fetchProjectAssignableUsersPage(
    projectKey: string,
    maxResults: number,
    startAt: number
  ): Promise<JiraUser[]> {
    const query = new URLSearchParams({
      project: projectKey,
      maxResults: String(maxResults),
      startAt: String(startAt)
    });

    let users: JiraUser[];
    try {
      users = await this.request<JiraUser[]>(
        `/rest/api/3/user/assignable/search?${query.toString()}`
      );
    } catch (error) {
      if (!(error instanceof JiraApiError) || error.status !== 400) {
        throw error;
      }

      const fallbackQuery = new URLSearchParams({
        projectKey,
        maxResults: String(maxResults),
        startAt: String(startAt)
      });

      users = await this.request<JiraUser[]>(
        `/rest/api/3/user/assignable/search?${fallbackQuery.toString()}`
      );
    }

    return users;
  }

  private toActiveAssignableUsers(users: JiraUser[]): AssignableUser[] {
    const deduped = new Map<string, AssignableUser>();

    for (const user of users) {
      if (user.active !== true) {
        continue;
      }

      const id = this.normalizeString(user.accountId);
      if (!id || deduped.has(id)) {
        continue;
      }

      deduped.set(id, {
        id,
        name: this.normalizeString(user.displayName) ?? "(no display name)",
        email: this.normalizeString(user.emailAddress) ?? null
      });
    }

    return [...deduped.values()];
  }

  private async fetchAllProjectAssignableUsers(
    projectKey: string,
    cap: number
  ): Promise<AssignableUser[]> {
    const pageSize = Math.min(200, Math.max(1, cap));
    const deduped = new Map<string, AssignableUser>();
    let startAt = 0;

    while (deduped.size < cap) {
      const page = await this.fetchProjectAssignableUsersPage(projectKey, pageSize, startAt);
      if (page.length === 0) {
        break;
      }

      const activeUsers = this.toActiveAssignableUsers(page);
      for (const user of activeUsers) {
        if (!deduped.has(user.id)) {
          deduped.set(user.id, user);
        }

        if (deduped.size >= cap) {
          break;
        }
      }

      startAt += page.length;
      if (page.length < pageSize) {
        break;
      }
    }

    return [...deduped.values()];
  }

  private async fetchTopAssignableUsersByRecentAssignments(
    projectKey: string,
    options: { days: number; limit: number }
  ): Promise<{ users: AssignableUser[]; truncated: boolean }> {
    const assignableUsers = await this.fetchAllProjectAssignableUsers(projectKey, 1000);
    if (assignableUsers.length === 0) {
      return {
        users: [],
        truncated: false
      };
    }

    const recentCounts = await this.countRecentAssignedIssuesByUser(projectKey, options.days);
    const scoredUsers = assignableUsers.map((user) => ({
      ...user,
      assignedIssuesLast60Days: recentCounts.counts.get(user.id) ?? 0
    }));

    scoredUsers.sort((left, right) => {
      const scoreDiff =
        (right.assignedIssuesLast60Days ?? 0) - (left.assignedIssuesLast60Days ?? 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return left.name.localeCompare(right.name);
    });

    return {
      users: scoredUsers.slice(0, Math.max(1, options.limit)),
      truncated: recentCounts.truncated
    };
  }

  private async countRecentAssignedIssuesByUser(
    projectKey: string,
    days: number
  ): Promise<{ counts: Map<string, number>; truncated: boolean }> {
    const now = Date.now();
    const windowStartMs = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
    const pageSize = 50;
    const maxIssuesToScan = 500;
    const countsByUser = new Map<string, Set<string>>();
    const fallbackByCurrentAssignee = new Map<string, Set<string>>();

    let startAt = 0;
    let total = Number.POSITIVE_INFINITY;
    let scannedIssues = 0;
    let truncated = false;

    while (startAt < total) {
      if (scannedIssues >= maxIssuesToScan) {
        truncated = true;
        break;
      }

      const jql = [
        `project = ${this.quoteJqlLiteral(projectKey)}`,
        `updated >= -${days}d`,
        "ORDER BY updated DESC"
      ].join(" AND ");

      const response = await this.request<JiraLegacySearchWithChangelogResponse>(
        "/rest/api/3/search",
        {
          method: "POST",
          body: JSON.stringify({
            jql,
            startAt,
            maxResults: pageSize,
            fields: ["assignee"],
            fieldsByKeys: false,
            expand: "changelog"
          })
        }
      );

      const issues = response.issues ?? [];
      if (issues.length === 0) {
        break;
      }

      total = response.total ?? startAt + issues.length;
      scannedIssues += issues.length;

      for (const issue of issues) {
        const issueKey = issue.key;

        const currentAssigneeId = this.normalizeString(
          (issue.fields.assignee as Record<string, unknown> | undefined)?.accountId
        );
        if (currentAssigneeId) {
          const set = fallbackByCurrentAssignee.get(currentAssigneeId) ?? new Set<string>();
          set.add(issueKey);
          fallbackByCurrentAssignee.set(currentAssigneeId, set);
        }

        for (const history of issue.changelog?.histories ?? []) {
          const createdMs = Date.parse(history.created ?? "");
          if (!Number.isFinite(createdMs) || createdMs < windowStartMs || createdMs > now) {
            continue;
          }

          for (const item of history.items ?? []) {
            const fieldKey =
              normalizeLabelForMatch(this.normalizeString(item.field)) ||
              normalizeLabelForMatch(this.normalizeString(item.fieldId));

            if (fieldKey !== "assignee") {
              continue;
            }

            const assigneeId = this.normalizeString(item.to);
            if (!assigneeId) {
              continue;
            }

            const set = countsByUser.get(assigneeId) ?? new Set<string>();
            set.add(issueKey);
            countsByUser.set(assigneeId, set);
          }
        }
      }

      startAt += issues.length;
    }

    const source = countsByUser.size > 0 ? countsByUser : fallbackByCurrentAssignee;
    const counts = new Map<string, number>();
    for (const [assigneeId, issueKeys] of source.entries()) {
      counts.set(assigneeId, issueKeys.size);
    }

    return {
      counts,
      truncated
    };
  }

  private defaultAllowedValues(
    field: BusinessFieldName,
    priorities: ProjectBaseline["priorities"],
    versions: ProjectBaseline["versions"]
  ): string[] {
    if (field === "priority") {
      return priorities.map((priority) => priority.name);
    }

    if (field === "fixVersions" || field === "affectedVersions") {
      return versions.map((version) => version.name);
    }

    return [];
  }

  private extractAllowedValues(values: unknown[] | undefined): string[] {
    if (!values || values.length === 0) {
      return [];
    }

    const deduped = new Set<string>();

    for (const value of values) {
      const scalarValue = this.extractScalarValue(value);
      if (scalarValue) {
        deduped.add(scalarValue);
      }

      if (deduped.size >= 30) {
        break;
      }
    }

    return [...deduped];
  }

  private getJiraFieldKeyForBusinessField(field: BusinessFieldName): string | undefined {
    if (field === "severity") {
      return this.config.severityFieldId;
    }

    if (field === "affectedVersions") {
      return "versions";
    }

    return field;
  }

  private async fetchIssueLinkTypes(): Promise<JiraIssueLinkType[]> {
    const response = await this.request<JiraIssueLinkTypeResponse>("/rest/api/3/issueLinkType");
    return response.issueLinkTypes ?? [];
  }

  private resolveIssueLinkPayload(
    issueKey: string,
    targetIssueKey: string,
    relation: string,
    linkTypes: JiraIssueLinkType[]
  ): {
    relation: string;
    linkType: string;
    direction: "outward" | "inward";
    outwardIssueKey: string;
    inwardIssueKey: string;
  } {
    const requestedAliases = labelAliasSet(relation);

    for (const linkType of linkTypes) {
      const name = this.normalizeString(linkType.name);
      const outward = this.normalizeString(linkType.outward);
      const inward = this.normalizeString(linkType.inward);

      if (!name) {
        continue;
      }

      if (outward && intersects(requestedAliases, labelAliasSet(outward))) {
        return {
          relation: outward,
          linkType: name,
          direction: "outward",
          outwardIssueKey: issueKey,
          inwardIssueKey: targetIssueKey
        };
      }

      if (inward && intersects(requestedAliases, labelAliasSet(inward))) {
        return {
          relation: inward,
          linkType: name,
          direction: "inward",
          outwardIssueKey: targetIssueKey,
          inwardIssueKey: issueKey
        };
      }

      if (intersects(requestedAliases, labelAliasSet(name))) {
        return {
          relation: outward ?? name,
          linkType: name,
          direction: "outward",
          outwardIssueKey: issueKey,
          inwardIssueKey: targetIssueKey
        };
      }
    }

    const availableRelations = linkTypes
      .flatMap((linkType) => [linkType.outward, linkType.inward, linkType.name])
      .map((value) => this.normalizeString(value))
      .filter((value): value is string => Boolean(value));

    const preview = [...new Set(availableRelations)].slice(0, 40).join(", ");

    throw new Error(
      `Unknown link relation '${relation}'. Available relations: ${preview || "(none)"}.`
    );
  }

  private async getIssueProjectKey(issueKey: string): Promise<string> {
    const query = new URLSearchParams({
      fields: "project",
      fieldsByKeys: "false"
    });

    const issue = await this.request<JiraIssueResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?${query.toString()}`
    );

    const projectKey = this.normalizeString(
      (issue.fields.project as Record<string, unknown> | undefined)?.key
    );

    if (!projectKey) {
      throw new Error(`Cannot resolve project key for issue ${issueKey}.`);
    }

    return projectKey;
  }

  private async getIssueComments(
    issueKey: string,
    options: IssueReadOptions
  ): Promise<{ comments: IssueComment[]; meta: IssueCommentsMeta }> {
    const skipComments = options.skipComments ?? false;
    const loadOnlyLast3Comments = options.loadOnlyLast3Comments ?? true;

    if (skipComments) {
      return {
        comments: [],
        meta: {
          mode: "skip",
          total: 0,
          returned: 0
        }
      };
    }

    if (loadOnlyLast3Comments) {
      return this.fetchLastIssueComments(issueKey, 3);
    }

    return this.fetchAllIssueComments(issueKey);
  }

  private async fetchLastIssueComments(
    issueKey: string,
    count: number
  ): Promise<{ comments: IssueComment[]; meta: IssueCommentsMeta }> {
    const page = await this.fetchIssueCommentsPage(issueKey, 0, 1);
    const total = page.total ?? (page.comments?.length ?? 0);

    if (total <= 0) {
      return {
        comments: [],
        meta: {
          mode: "last_3",
          total: 0,
          returned: 0
        }
      };
    }

    const startAt = Math.max(0, total - count);
    const commentsPage = await this.fetchIssueCommentsPage(issueKey, startAt, count);
    const comments = (commentsPage.comments ?? []).map((comment) => this.toIssueComment(comment));

    return {
      comments,
      meta: {
        mode: "last_3",
        total,
        returned: comments.length
      }
    };
  }

  private async fetchAllIssueComments(
    issueKey: string
  ): Promise<{ comments: IssueComment[]; meta: IssueCommentsMeta }> {
    const comments: IssueComment[] = [];
    const pageSize = 100;
    let startAt = 0;
    let total: number | undefined;

    while (true) {
      const page = await this.fetchIssueCommentsPage(issueKey, startAt, pageSize);

      if (typeof page.total === "number") {
        total = page.total;
      }

      const batch = (page.comments ?? []).map((comment) => this.toIssueComment(comment));
      comments.push(...batch);

      if (batch.length === 0) {
        break;
      }

      startAt += batch.length;

      if (typeof total === "number" && startAt >= total) {
        break;
      }
    }

    return {
      comments,
      meta: {
        mode: "all",
        total: total ?? comments.length,
        returned: comments.length
      }
    };
  }

  private async fetchIssueCommentsPage(
    issueKey: string,
    startAt: number,
    maxResults: number
  ): Promise<JiraCommentPageResponse> {
    const query = new URLSearchParams({
      startAt: String(startAt),
      maxResults: String(maxResults)
    });

    return this.request<JiraCommentPageResponse>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?${query.toString()}`
    );
  }

  private async fetchActiveSprints(projectKey: string): Promise<ProjectBaseline["activeSprints"]> {
    const boards = await this.fetchScrumBoards(projectKey);
    if (boards.length === 0) {
      return [];
    }

    return this.fetchSprintsFromBoards(boards, "active", 10);
  }

  private normalizeSprintStateFilter(input: ListSprintsInput["state"]): SprintStateFilter {
    const normalized = input?.trim().toLowerCase();
    if (!normalized) {
      return "active";
    }

    if (
      normalized === "active" ||
      normalized === "future" ||
      normalized === "closed" ||
      normalized === "all"
    ) {
      return normalized;
    }

    throw new Error("state must be one of: active, future, closed, all.");
  }

  private parseMaxResultsPerBoard(input: number | undefined): number {
    if (input === undefined) {
      return 20;
    }

    if (!Number.isInteger(input) || input < 1 || input > 50) {
      throw new Error("maxResultsPerBoard must be an integer between 1 and 50.");
    }

    return input;
  }

  private async fetchScrumBoards(
    projectKey: string,
    boardName?: string
  ): Promise<Array<{ id: number; name: string }>> {
    const boardQuery = new URLSearchParams({
      projectKeyOrId: projectKey,
      type: "scrum",
      maxResults: "50"
    });

    const boards = await this.request<JiraBoardSearchResponse>(
      `/rest/agile/1.0/board?${boardQuery.toString()}`
    );

    const requestedBoardName = normalizeLabelForMatch(boardName);

    return (boards.values ?? [])
      .map((board) => {
        if (typeof board.id !== "number" || !board.name) {
          return null;
        }

        if (
          requestedBoardName &&
          normalizeLabelForMatch(board.name) !== requestedBoardName
        ) {
          return null;
        }

        return {
          id: board.id,
          name: board.name
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
  }

  private async fetchSprintsFromBoards(
    boards: Array<{ id: number; name: string }>,
    state: SprintStateFilter,
    maxResultsPerBoard: number
  ): Promise<ProjectBaseline["activeSprints"]> {
    const stateQuery = this.toSprintStateQuery(state);

    const sprintCollections = await Promise.all(
      boards.map(async (board) => {
        try {
          const sprintQuery = new URLSearchParams({
            maxResults: String(maxResultsPerBoard)
          });

          if (stateQuery) {
            sprintQuery.set("state", stateQuery);
          }

          const response = await this.request<JiraSprintSearchResponse>(
            `/rest/agile/1.0/board/${board.id}/sprint?${sprintQuery.toString()}`
          );

          return (response.values ?? [])
            .map((sprint) => this.toSprintSummary(sprint, board))
            .filter((value): value is NonNullable<typeof value> => Boolean(value));
        } catch {
          return [];
        }
      })
    );

    const deduped = new Map<number, ProjectBaseline["activeSprints"][number]>();
    for (const sprint of sprintCollections.flat()) {
      if (!deduped.has(sprint.id)) {
        deduped.set(sprint.id, sprint);
      }
    }

    return [...deduped.values()].sort((left, right) => {
      const stateRank = this.sprintStateRank(left.state) - this.sprintStateRank(right.state);
      if (stateRank !== 0) {
        return stateRank;
      }

      return left.name.localeCompare(right.name);
    });
  }

  private toSprintStateQuery(state: SprintStateFilter): string | null {
    if (state === "active") {
      return "active";
    }

    if (state === "all") {
      return "active,future,closed";
    }

    return state;
  }

  private sprintStateRank(state: string): number {
    const normalized = state.trim().toLowerCase();
    if (normalized === "active") {
      return 0;
    }

    if (normalized === "future") {
      return 1;
    }

    if (normalized === "closed") {
      return 2;
    }

    return 3;
  }

  private toSprintSummary(
    sprint: JiraSprintResponse,
    board: { id: number; name: string }
  ): ProjectBaseline["activeSprints"][number] | null {
    if (typeof sprint.id !== "number" || !sprint.name || !sprint.state) {
      return null;
    }

    const goal = sprint.goal?.trim() ?? "";
    const startDate = sprint.startDate ?? null;
    const endDate = sprint.endDate ?? null;

    return {
      id: sprint.id,
      name: sprint.name,
      state: sprint.state,
      description: this.buildSprintDescription({
        name: sprint.name,
        state: sprint.state,
        goal,
        startDate,
        endDate,
        boardName: board.name
      }),
      goal,
      startDate,
      endDate,
      board
    };
  }

  private buildSprintDescription(input: {
    name: string;
    state: string;
    goal: string;
    startDate: string | null;
    endDate: string | null;
    boardName: string;
  }): string {
    const dateWindow =
      input.startDate || input.endDate
        ? `${input.startDate ?? "unknown start"} -> ${input.endDate ?? "unknown end"}`
        : "dates not set";

    const goalText = input.goal ? `Goal: ${input.goal}` : "Goal: (empty)";
    return `Sprint '${input.name}' on board '${input.boardName}' is '${input.state}'. ${goalText}. Dates: ${dateWindow}.`;
  }

  private async resolveSprintForAssignment(
    input: AssignIssueToSprintInput,
    issueKey: string
  ): Promise<ProjectBaseline["activeSprints"][number]> {
    const hasSprintId = typeof input.sprintId === "number";
    const hasSprintName = Boolean(input.sprintName?.trim());

    if (hasSprintId && hasSprintName) {
      throw new Error("Provide either sprintId or sprintName, not both.");
    }

    if (!hasSprintId && !hasSprintName) {
      throw new Error("Provide sprintId or sprintName.");
    }

    if (typeof input.sprintId === "number") {
      const sprintId = input.sprintId;
      if (!Number.isInteger(sprintId) || sprintId <= 0) {
        throw new Error("sprintId must be a positive integer.");
      }

      return this.fetchSprintById(sprintId);
    }

    const sprintName = input.sprintName?.trim();
    if (!sprintName) {
      throw new Error("sprintName cannot be empty.");
    }

    const projectKey = input.projectKey?.trim() || (await this.getIssueProjectKey(issueKey));
    const sprintsResult = await this.listSprints({
      projectKey,
      state: "all",
      ...(input.boardName?.trim() ? { boardName: input.boardName.trim() } : {}),
      maxResultsPerBoard: 50
    });

    const normalizedRequested = normalizeLabelForMatch(sprintName);
    const matches = sprintsResult.sprints.filter(
      (sprint) => normalizeLabelForMatch(sprint.name) === normalizedRequested
    );

    if (matches.length === 0) {
      const preview = sprintsResult.sprints
        .slice(0, 20)
        .map((sprint) => `${sprint.id}:${sprint.name} (${sprint.state})`)
        .join(", ");

      throw new Error(
        `Sprint '${sprintName}' not found for project ${projectKey}. Available sprints: ${preview || "(none)"}.`
      );
    }

    if (matches.length > 1) {
      const details = matches
        .map((sprint) => `${sprint.id}:${sprint.name} on '${sprint.board.name}' (${sprint.state})`)
        .join(", ");

      throw new Error(
        `Sprint name '${sprintName}' is ambiguous. Use sprintId. Matches: ${details}.`
      );
    }

    const first = matches[0];
    if (!first) {
      throw new Error("Unexpected sprint selection error.");
    }

    return first;
  }

  private async fetchSprintById(sprintId: number): Promise<ProjectBaseline["activeSprints"][number]> {
    const sprint = await this.request<JiraSprintResponse>(
      `/rest/agile/1.0/sprint/${encodeURIComponent(String(sprintId))}`
    );

    const boardId =
      typeof sprint.originBoardId === "number"
        ? sprint.originBoardId
        : typeof sprint.boardId === "number"
          ? sprint.boardId
          : null;

    let boardName = boardId !== null ? `Board ${boardId}` : "Unknown board";
    if (boardId !== null) {
      try {
        const board = await this.request<JiraBoardResponse>(
          `/rest/agile/1.0/board/${encodeURIComponent(String(boardId))}`
        );
        boardName = this.normalizeString(board.name) ?? boardName;
      } catch {
        // Keep fallback board name.
      }
    }

    const summary = this.toSprintSummary(sprint, {
      id: boardId ?? 0,
      name: boardName
    });

    if (!summary) {
      throw new Error(`Sprint ${sprintId} is missing mandatory fields in Jira response.`);
    }

    return summary;
  }

  private defaultSeverityContext(): ProjectBaseline["severity"] {
    return {
      configured: Boolean(this.config.severityFieldId),
      fieldId: this.config.severityFieldId ?? null,
      jqlField: this.config.severityJqlField,
      valueType: this.config.severityValueType,
      options: []
    };
  }

  private async buildSeverityContext(projectKey: string): Promise<ProjectBaseline["severity"]> {
    const context = this.defaultSeverityContext();
    if (!this.config.severityFieldId) {
      return context;
    }

    const metaByIssueType = await this.fetchCreateMetaFieldMap(projectKey);
    const deduped = new Map<string, ProjectBaseline["severity"]["options"][number]>();

    for (const fieldsMeta of metaByIssueType.values()) {
      const severityMeta = fieldsMeta[this.config.severityFieldId];
      const details = this.extractAllowedValueDetails(severityMeta?.allowedValues);

      for (const detail of details) {
        const key = `${detail.id ?? "_"}::${detail.value.toLowerCase()}`;
        if (!deduped.has(key)) {
          deduped.set(key, detail);
        }
      }
    }

    return {
      ...context,
      options: [...deduped.values()]
    };
  }

  private extractAllowedValueDetails(
    values: unknown[] | undefined
  ): ProjectBaseline["severity"]["options"] {
    if (!values || values.length === 0) {
      return [];
    }

    const details: ProjectBaseline["severity"]["options"] = [];

    for (const rawValue of values) {
      if (rawValue && typeof rawValue === "object") {
        const asRecord = rawValue as Record<string, unknown>;
        const idValue = asRecord.id;
        const id =
          this.normalizeString(idValue) ??
          (typeof idValue === "number" ? String(idValue) : null);

        const value =
          this.normalizeString(asRecord.value) ??
          this.normalizeString(asRecord.name) ??
          this.normalizeString(asRecord.label) ??
          this.extractScalarValue(rawValue);

        if (!value) {
          continue;
        }

        details.push({
          id,
          value,
          description: this.normalizeString(asRecord.description) ?? ""
        });
      } else {
        const scalar = this.extractScalarValue(rawValue);
        if (!scalar) {
          continue;
        }

        details.push({
          id: null,
          value: scalar,
          description: ""
        });
      }

      if (details.length >= 60) {
        break;
      }
    }

    return details;
  }

  private buildJql(input: SearchIssuesInput): string {
    const clauses: string[] = [];

    if (input.projectKey) {
      clauses.push(`project = ${this.quoteJqlLiteral(input.projectKey)}`);
    }

    const issueKeysClause = this.buildJqlListClause("key", input.issueKeys);
    if (issueKeysClause) {
      clauses.push(issueKeysClause);
    }

    const issueTypesClause = this.buildJqlListClause("issuetype", input.issueTypes);
    if (issueTypesClause) {
      clauses.push(issueTypesClause);
    }

    if (input.summaryContains?.trim()) {
      clauses.push(`summary ~ ${this.quoteJqlLiteral(input.summaryContains.trim())}`);
    }

    if (input.descriptionContains?.trim()) {
      clauses.push(`description ~ ${this.quoteJqlLiteral(input.descriptionContains.trim())}`);
    }

    const fixVersionsClause = this.buildJqlListClause("fixVersion", input.fixVersions);
    if (fixVersionsClause) {
      clauses.push(fixVersionsClause);
    }

    const affectedVersionsClause = this.buildJqlListClause("affectedVersion", input.affectedVersions);
    if (affectedVersionsClause) {
      clauses.push(affectedVersionsClause);
    }

    const statusesClause = this.buildJqlListClause("status", input.statuses);
    if (statusesClause) {
      clauses.push(statusesClause);
    }

    const prioritiesClause = this.buildJqlListClause("priority", input.priorities);
    if (prioritiesClause) {
      clauses.push(prioritiesClause);
    }

    const severitiesClause = this.buildJqlListClause(
      this.formatSeverityJqlField(),
      input.severities
    );
    if (severitiesClause) {
      clauses.push(severitiesClause);
    }

    let jql = input.jql?.trim() ?? "";
    const filtersJql = clauses.join(" AND ");

    if (jql && filtersJql) {
      jql = `(${jql}) AND (${filtersJql})`;
    } else if (!jql) {
      jql = filtersJql;
    }

    if (!jql) {
      throw new Error("Provide at least one filter field or a raw jql query.");
    }

    if (!/\border\s+by\b/i.test(jql)) {
      jql = `${jql} ORDER BY updated DESC`;
    }

    return jql;
  }

  private buildStrictJql(rawJql: string): string {
    const jql = rawJql.trim();

    if (!jql) {
      throw new Error("jql cannot be empty.");
    }

    if (!/\border\s+by\b/i.test(jql)) {
      return `${jql} ORDER BY updated DESC`;
    }

    return jql;
  }

  private buildJqlListClause(field: string, values: string[] | undefined): string | null {
    const normalized = (values ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (normalized.length === 0) {
      return null;
    }

    if (normalized.length === 1) {
      const first = normalized[0];
      if (!first) {
        return null;
      }

      return `${field} = ${this.quoteJqlLiteral(first)}`;
    }

    return `${field} IN (${normalized.map((value) => this.quoteJqlLiteral(value)).join(", ")})`;
  }

  private formatSeverityJqlField(): string {
    const raw = this.config.severityJqlField.trim();
    const customFieldMatch = raw.match(/^customfield_(\d+)$/i);

    if (customFieldMatch) {
      return `cf[${customFieldMatch[1]}]`;
    }

    if (/^cf\[\d+\]$/i.test(raw) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
      return raw;
    }

    return `"${raw.replace(/"/g, '\\"')}"`;
  }

  private quoteJqlLiteral(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  private getIssueFields(): string[] {
    const fields = [
      "summary",
      "description",
      "fixVersions",
      "versions",
      "status",
      "priority",
      "issuetype",
      "project",
      "parent",
      "subtasks",
      "issuelinks"
    ];

    if (this.config.severityFieldId) {
      fields.push(this.config.severityFieldId);
    }

    return fields;
  }

  private getIssueListFields(): string[] {
    return ["summary", "fixVersions", "assignee", "reporter", "priority", "status", "sprint"];
  }

  private async resolveIssueTypeId(projectKey: string, requested: string): Promise<string> {
    const project = await this.request<JiraProjectResponse>(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}`
    );

    const normalized = requested.trim().toLowerCase();

    const match = (project.issueTypes ?? []).find((issueType) => {
      const id = issueType.id?.trim();
      const name = issueType.name?.trim().toLowerCase();
      return id === requested || name === normalized;
    });

    if (!match?.id) {
      const available = (project.issueTypes ?? [])
        .map((issueType) => issueType.name)
        .filter((value): value is string => Boolean(value))
        .join(", ");

      throw new Error(
        `Unknown issue type '${requested}' for project ${projectKey}. Available: ${available || "(none)"}.`
      );
    }

    return match.id;
  }

  private async resolveVersionIds(projectKey: string, requested: string[] | undefined): Promise<string[]> {
    const normalizedRequested = (requested ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (normalizedRequested.length === 0) {
      return [];
    }

    const versions = await this.request<JiraVersion[]>(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`
    );

    const byId = new Map<string, JiraVersion>();
    const byName = new Map<string, JiraVersion>();

    for (const version of versions) {
      if (version.id) {
        byId.set(version.id, version);
      }

      if (version.name) {
        byName.set(version.name.toLowerCase(), version);
      }
    }

    const missing: string[] = [];
    const resolved = new Set<string>();

    for (const value of normalizedRequested) {
      const byIdMatch = byId.get(value);
      if (byIdMatch?.id) {
        resolved.add(byIdMatch.id);
        continue;
      }

      const byNameMatch = byName.get(value.toLowerCase());
      if (byNameMatch?.id) {
        resolved.add(byNameMatch.id);
        continue;
      }

      missing.push(value);
    }

    if (missing.length > 0) {
      throw new Error(
        `Unknown project version(s): ${missing.join(", ")}. Use exact Jira version names or ids.`
      );
    }

    return [...resolved];
  }

  private buildPriorityPayload(priority: string | undefined): { id: string } | { name: string } | undefined {
    const normalized = priority?.trim();

    if (!normalized) {
      return undefined;
    }

    if (/^\d+$/.test(normalized)) {
      return { id: normalized };
    }

    return { name: normalized };
  }

  private buildPriorityUpdateValue(
    priority: string | null | undefined
  ): { id: string } | { name: string } | null | undefined {
    if (priority === undefined) {
      return undefined;
    }

    if (priority === null) {
      return null;
    }

    const normalized = priority.trim();

    if (!normalized) {
      return null;
    }

    if (/^\d+$/.test(normalized)) {
      return { id: normalized };
    }

    return { name: normalized };
  }

  private buildSeverityPayload(severity: string | undefined): unknown {
    const normalized = severity?.trim();

    if (!normalized) {
      return undefined;
    }

    if (this.config.severityValueType === "string") {
      return normalized;
    }

    if (this.config.severityValueType === "number") {
      const numberValue = Number(normalized);
      if (!Number.isFinite(numberValue)) {
        throw new Error(
          `Severity '${normalized}' is not numeric but JIRA_SEVERITY_VALUE_TYPE is 'number'.`
        );
      }

      return numberValue;
    }

    return { value: normalized };
  }

  private buildSeverityUpdateValue(severity: string | null | undefined): unknown {
    if (severity === undefined) {
      return undefined;
    }

    if (severity === null) {
      return null;
    }

    const normalized = severity.trim();

    if (!normalized) {
      return null;
    }

    return this.buildSeverityPayload(normalized);
  }

  private async tryTransitionIssue(issueKey: string, status: string): Promise<IssueTransitionResult> {
    const requestedStatus = status.trim();

    if (!requestedStatus) {
      return {
        requestedStatus: status,
        applied: false,
        reason: "Requested status is empty."
      };
    }

    const transitions = await this.listIssueTransitions(issueKey);
    const normalizedRequested = requestedStatus.toLowerCase();

    const matched = transitions.find((transition) => {
      const id = transition.id?.toLowerCase();
      const name = transition.name?.toLowerCase();
      const targetName = transition.to?.name?.toLowerCase();

      return (
        id === normalizedRequested ||
        name === normalizedRequested ||
        targetName === normalizedRequested
      );
    });

    if (!matched?.id) {
      const available = transitions
        .map((transition) => transition.to?.name ?? transition.name)
        .filter((value): value is string => Boolean(value))
        .join(", ");

      return {
        requestedStatus,
        applied: false,
        reason: `No matching transition found. Available target statuses: ${available || "(none)"}.`
      };
    }

    await this.request<void>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: "POST",
      body: JSON.stringify({
        transition: {
          id: matched.id
        }
      })
    });

    return {
      requestedStatus,
      applied: true,
      transitionId: matched.id,
      ...((matched.to?.name ?? matched.name)
        ? { targetStatus: matched.to?.name ?? matched.name }
        : {})
    };
  }

  private toFocusedIssue(
    issue: JiraIssueResponse,
    comments: IssueComment[] = [],
    commentsMeta: IssueCommentsMeta = {
      mode: "skip",
      total: 0,
      returned: 0
    },
    descriptionFormat?: DescriptionFormat
  ): FocusedIssue {
    const fields = issue.fields ?? {};

    const statusRaw = fields.status as Record<string, unknown> | undefined;
    const priorityRaw = fields.priority as Record<string, unknown> | undefined;
    const issueTypeRaw = fields.issuetype as Record<string, unknown> | undefined;
    const projectRaw = fields.project as Record<string, unknown> | undefined;

    const severityRaw = this.config.severityFieldId
      ? fields[this.config.severityFieldId]
      : fields.severity;

    return {
      key: issue.key,
      summary: this.normalizeString(fields.summary) ?? "",
      description: this.toDescriptionOutput(fields.description, descriptionFormat),
      fixVersions: this.extractNameList(fields.fixVersions),
      affectedVersions: this.extractNameList(fields.versions),
      status: this.extractStatus(statusRaw),
      priority: this.extractIssueRef(priorityRaw),
      severity: this.extractScalarValue(severityRaw),
      issueType: this.extractIssueRef(issueTypeRaw),
      projectKey: this.normalizeString(projectRaw?.key) ?? null,
      parent: this.toCompactIssueRef(fields.parent),
      subtasks: this.extractIssueRefsFromArray(fields.subtasks),
      linkedIssues: this.extractLinkedIssues(fields.issuelinks),
      comments,
      commentsMeta
    };
  }

  private toDescriptionOutput(
    description: unknown,
    descriptionFormat: DescriptionFormat | undefined
  ): IssueDescription {
    const format = this.normalizeDescriptionFormat(descriptionFormat);
    if (format === "adf") {
      return this.toAdfDocument(description);
    }

    return adfToPlainText(description);
  }

  private toJiraDescription(
    description: IssueDescription,
    descriptionFormat: DescriptionFormat | undefined
  ): Record<string, unknown> {
    const format = this.normalizeDescriptionFormat(descriptionFormat);

    if (format === "adf") {
      return this.parseAdfInput(description);
    }

    if (typeof description !== "string") {
      throw new Error(
        "description must be a string when descriptionFormat is plain_text (or omitted)."
      );
    }

    return plainTextToAdf(description);
  }

  private normalizeDescriptionFormat(
    descriptionFormat: DescriptionFormat | undefined
  ): DescriptionFormat {
    return descriptionFormat === "adf" ? "adf" : "plain_text";
  }

  private parseAdfInput(description: IssueDescription): Record<string, unknown> {
    const parsed = this.parseAdfLikeValue(description);
    if (!parsed || !this.isAdfDocument(parsed)) {
      throw new Error(
        "description must be a valid ADF document when descriptionFormat=adf. Expected object: { type: 'doc', version: 1, content: [...] }."
      );
    }

    return parsed;
  }

  private toAdfDocument(value: unknown): Record<string, unknown> {
    const parsed = this.parseAdfLikeValue(value);
    if (!parsed || !this.isAdfDocument(parsed)) {
      return {
        type: "doc",
        version: 1,
        content: []
      };
    }

    return parsed;
  }

  private parseAdfLikeValue(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return null;
        }

        return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return null;
  }

  private isAdfDocument(value: Record<string, unknown>): boolean {
    return (
      this.normalizeString(value.type) === "doc" &&
      typeof value.version === "number" &&
      Array.isArray(value.content)
    );
  }

  private toJqlIssueListItem(issue: JiraIssueResponse): JqlIssueListItem {
    const fields = issue.fields ?? {};
    const statusRaw = fields.status as Record<string, unknown> | undefined;

    return {
      key: issue.key,
      summary: this.normalizeString(fields.summary) ?? "",
      fixVersions: this.extractNameList(fields.fixVersions),
      sprints: this.extractSprintNames(fields.sprint),
      assignee: this.extractUserName(fields.assignee),
      reporter: this.extractUserName(fields.reporter),
      priority: this.extractScalarValue(fields.priority),
      status: this.normalizeString(statusRaw?.name) ?? null
    };
  }

  private toIssueComment(comment: JiraCommentResponse): IssueComment {
    const id = this.normalizeString(comment.id) ?? "unknown";
    const accountId = this.normalizeString(comment.author?.accountId);
    const displayName = this.normalizeString(comment.author?.displayName);

    return {
      id,
      body: adfToPlainText(comment.body),
      author: {
        ...(accountId ? { accountId } : {}),
        ...(displayName ? { displayName } : {})
      },
      created: this.normalizeString(comment.created) ?? null,
      updated: this.normalizeString(comment.updated) ?? null
    };
  }

  private toCompactIssueRef(value: unknown): CompactIssueRef | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const issue = value as Record<string, unknown>;
    const key = this.normalizeString(issue.key);

    if (!key) {
      return null;
    }

    const fields = issue.fields as Record<string, unknown> | undefined;
    const summary = this.normalizeString(fields?.summary) ?? "";
    const status = this.normalizeString(
      (fields?.status as Record<string, unknown> | undefined)?.name
    );
    const issueType = this.normalizeString(
      (fields?.issuetype as Record<string, unknown> | undefined)?.name
    );

    return {
      key,
      summary,
      status: status ?? null,
      issueType: issueType ?? null
    };
  }

  private extractIssueRefsFromArray(value: unknown): CompactIssueRef[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const deduped = new Map<string, CompactIssueRef>();

    for (const entry of value) {
      const issueRef = this.toCompactIssueRef(entry);
      if (issueRef && !deduped.has(issueRef.key)) {
        deduped.set(issueRef.key, issueRef);
      }
    }

    return [...deduped.values()];
  }

  private extractLinkedIssues(value: unknown): FocusedIssue["linkedIssues"] {
    if (!Array.isArray(value)) {
      return [];
    }

    const linkedIssues: FocusedIssue["linkedIssues"] = [];
    const deduped = new Set<string>();

    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const link = entry as Record<string, unknown>;
      const linkType = link.type as Record<string, unknown> | undefined;
      const linkTypeName = this.normalizeString(linkType?.name) ?? null;

      const outwardIssue = this.toCompactIssueRef(link.outwardIssue);
      if (outwardIssue) {
        const relation = this.normalizeString(linkType?.outward) ?? linkTypeName ?? "related";
        const key = `outward:${outwardIssue.key}:${relation}`;

        if (!deduped.has(key)) {
          deduped.add(key);
          linkedIssues.push({
            ...outwardIssue,
            relation,
            direction: "outward",
            linkType: linkTypeName
          });
        }
      }

      const inwardIssue = this.toCompactIssueRef(link.inwardIssue);
      if (inwardIssue) {
        const relation = this.normalizeString(linkType?.inward) ?? linkTypeName ?? "related";
        const key = `inward:${inwardIssue.key}:${relation}`;

        if (!deduped.has(key)) {
          deduped.add(key);
          linkedIssues.push({
            ...inwardIssue,
            relation,
            direction: "inward",
            linkType: linkTypeName
          });
        }
      }
    }

    return linkedIssues;
  }

  private extractNameList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.extractScalarValue(entry))
      .filter((item): item is string => Boolean(item));
  }

  private extractSprintNames(value: unknown): string[] {
    const names = new Set<string>();
    const entries = Array.isArray(value) ? value : [value];

    for (const entry of entries) {
      const directName = this.normalizeString((entry as Record<string, unknown> | undefined)?.name);
      if (directName) {
        names.add(directName);
        continue;
      }

      const rawValue = this.normalizeString(entry);
      if (!rawValue) {
        continue;
      }

      const match = rawValue.match(/name=([^,\]]+)/i);
      if (match?.[1]) {
        names.add(match[1].trim());
      }
    }

    return [...names];
  }

  private extractUserName(value: unknown): string | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const user = value as Record<string, unknown>;
    return (
      this.normalizeString(user.displayName) ??
      this.normalizeString(user.name) ??
      this.normalizeString(user.emailAddress) ??
      this.normalizeString(user.accountId) ??
      null
    );
  }

  private extractIssueRef(value: Record<string, unknown> | undefined): IssueRef | null {
    if (!value) {
      return null;
    }

    const id = this.normalizeString(value.id);
    const name = this.normalizeString(value.name);

    if (!id && !name) {
      return null;
    }

    return {
      ...(id ? { id } : {}),
      ...(name ? { name } : {})
    };
  }

  private extractStatus(value: Record<string, unknown> | undefined): FocusedIssue["status"] {
    if (!value) {
      return null;
    }

    const id = this.normalizeString(value.id);
    const name = this.normalizeString(value.name);
    const category = this.normalizeString(
      (value.statusCategory as Record<string, unknown> | undefined)?.name
    );

    if (!id && !name && !category) {
      return null;
    }

    return {
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      ...(category ? { category } : {})
    };
  }

  private extractScalarValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized || null;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (Array.isArray(value)) {
      const rendered = value
        .map((item) => this.extractScalarValue(item))
        .filter((item): item is string => Boolean(item));

      return rendered.length > 0 ? rendered.join(", ") : null;
    }

    if (typeof value === "object") {
      const asRecord = value as Record<string, unknown>;

      const candidates = [
        asRecord.name,
        asRecord.value,
        asRecord.label,
        asRecord.displayName,
        asRecord.key,
        asRecord.id
      ];

      for (const candidate of candidates) {
        const normalized = this.normalizeString(candidate);
        if (normalized) {
          return normalized;
        }
      }
    }

    return null;
  }

  private normalizeString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private requireString(value: string | undefined, message: string): string {
    if (!value || value.trim().length === 0) {
      throw new Error(message);
    }

    return value;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(path, `${this.config.baseUrl}/`);
    const headers = new Headers(init.headers);

    headers.set("Accept", "application/json");
    headers.set("Authorization", this.config.authHeader);

    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await safeReadBody(response);
        throw new JiraApiError(
          `${init.method ?? "GET"} ${url.pathname} failed with ${response.status} ${response.statusText}`,
          response.status,
          body
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return (await response.text()) as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Jira API request timed out after ${this.config.requestTimeoutMs}ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseNextPageToken(token: string | undefined): number {
  if (!token) {
    return 0;
  }

  const parsed = Number.parseInt(token, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid nextPageToken '${token}' for legacy Jira search.`);
  }

  return parsed;
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 4_000);
  } catch {
    return "";
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof JiraApiError) {
    const body = error.body?.trim();
    if (body) {
      return `${error.message}; body: ${body}`;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function normalizeLabelForMatch(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function labelAliasSet(value: string): Set<string> {
  const normalized = normalizeLabelForMatch(value);
  const aliases = new Set<string>();

  if (normalized) {
    aliases.add(normalized);
  }

  if (normalized.startsWith("is") && normalized.length > 2) {
    aliases.add(normalized.slice(2));
  }

  return aliases;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}
