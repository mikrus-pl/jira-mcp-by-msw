export interface IssueRef {
  id?: string;
  name?: string;
}

export interface IssueUserRef {
  id?: string;
  name?: string;
  email?: string | null;
}

export type DescriptionFormat = "plain_text" | "adf";
export type IssueDescription = string | Record<string, unknown>;

export interface AssignableUser {
  id: string;
  name: string;
  email: string | null;
  assignedIssuesLast60Days?: number;
}

export type CommentReadMode = "skip" | "last_3" | "all";

export interface IssueComment {
  id: string;
  body: string;
  author: {
    accountId?: string;
    displayName?: string;
  };
  created: string | null;
  updated: string | null;
}

export interface IssueCommentsMeta {
  mode: CommentReadMode;
  total: number;
  returned: number;
}

export interface IssueReadOptions {
  skipComments?: boolean;
  loadOnlyLast3Comments?: boolean;
  descriptionFormat?: DescriptionFormat;
}

export interface CompactIssueRef {
  key: string;
  url: string;
  summary: string;
  status: string | null;
  issueType: string | null;
}

export interface LinkedIssueRef extends CompactIssueRef {
  relation: string;
  direction: "outward" | "inward";
  linkType: string | null;
}

export interface FocusedIssue {
  key: string;
  url: string;
  summary: string;
  description: IssueDescription;
  fixVersions: string[];
  affectedVersions: string[];
  labels: string[];
  status: {
    id?: string;
    name?: string;
    category?: string | null;
  } | null;
  priority: IssueRef | null;
  severity: string | null;
  issueType: IssueRef | null;
  projectKey: string | null;
  assignee: IssueUserRef | null;
  reporter: IssueUserRef | null;
  parent: CompactIssueRef | null;
  subtasks: CompactIssueRef[];
  linkedIssues: LinkedIssueRef[];
  comments: IssueComment[];
  commentsMeta: IssueCommentsMeta;
}

export interface IssueTransitionResult {
  requestedStatus: string;
  applied: boolean;
  transitionId?: string;
  targetStatus?: string;
  reason?: string;
}

export interface CreateIssueInput {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: IssueDescription;
  descriptionFormat?: DescriptionFormat;
  fixVersions?: string[];
  affectedVersions?: string[];
  labels?: string[];
  priority?: string;
  severity?: string;
  assignee?: string;
  parentIssueKey?: string;
}

export interface CreateIssueResult {
  issue: FocusedIssue;
}

export interface UpdateIssueInput extends IssueReadOptions {
  issueKey: string;
  summary?: string;
  description?: IssueDescription | null;
  descriptionFormat?: DescriptionFormat;
  fixVersions?: string[];
  affectedVersions?: string[];
  labels?: string[];
  priority?: string | null;
  severity?: string | null;
  assignee?: string | null;
  notifyUsers?: boolean;
}

export interface UpdateIssueResult {
  issue: FocusedIssue;
}

export interface TransitionIssueInput extends IssueReadOptions {
  issueKey: string;
  toStatus: string;
}

export interface TransitionIssueResult {
  issue: FocusedIssue;
  transition: IssueTransitionResult;
}

export interface AddCommentInput {
  issueKey: string;
  body: string;
}

export interface AddCommentResult {
  issueKey: string;
  comment: IssueComment;
}

export interface LinkIssueInput {
  issueKey: string;
  targetIssueKey: string;
  relation: string;
  comment?: string;
}

export interface LinkIssueResult {
  issueKey: string;
  targetIssueKey: string;
  issueUrl: string;
  targetIssueUrl: string;
  relation: string;
  linkType: string;
  direction: "outward" | "inward";
}

export interface IssueLinkTypeSummary {
  id: string | null;
  name: string;
  inward: string | null;
  outward: string | null;
}

export interface ListIssueLinkTypesResult {
  linkTypes: IssueLinkTypeSummary[];
}

export interface SetIssueParentInput extends IssueReadOptions {
  issueKey: string;
  parentIssueKey?: string | null;
}

export interface SetIssueParentResult {
  issue: FocusedIssue;
  parent: CompactIssueRef | null;
}

export interface IssueWorkflowTransition {
  id: string | null;
  name: string | null;
  targetStatus: string | null;
}

export interface GetIssueWorkflowInput {
  issueKey: string;
}

export interface GetIssueWorkflowResult {
  issue: {
    key: string;
    url: string;
    summary: string;
    projectKey: string | null;
    issueType: IssueRef | null;
    status: FocusedIssue["status"];
    parent: CompactIssueRef | null;
    updatedAt: string | null;
    lastStatusChangeAt: string | null;
  };
  availableTransitions: IssueWorkflowTransition[];
}

export interface SearchIssuesInput {
  projectKey?: string;
  issueKeys?: string[];
  issueTypes?: string[];
  summaryContains?: string;
  descriptionContains?: string;
  fixVersions?: string[];
  affectedVersions?: string[];
  statuses?: string[];
  priorities?: string[];
  severities?: string[];
  jql?: string;
  maxResults?: number;
  nextPageToken?: string;
}

export interface SearchIssuesResult {
  jql: string;
  issues: FocusedIssue[];
  nextPageToken: string | null;
  mode: "enhanced" | "legacy";
}

export interface JqlIssueListItem {
  key: string;
  url: string;
  summary: string;
  fixVersions: string[];
  sprints: string[];
  assignee: string | null;
  reporter: string | null;
  priority: string | null;
  status: string | null;
}

export interface SearchIssuesByJqlInput {
  jql: string;
}

export interface SearchIssuesByJqlResult {
  jql: string;
  issues: JqlIssueListItem[];
  truncated: boolean;
  notice: string | null;
  mode: "enhanced" | "legacy";
}

export type SprintStateFilter = "active" | "future" | "closed" | "all";

export interface SprintSummary {
  id: number;
  name: string;
  state: string;
  description: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  board: {
    id: number;
    name: string;
  };
}

export interface ListSprintsInput {
  projectKey: string;
  state?: SprintStateFilter;
  boardName?: string;
  maxResultsPerBoard?: number;
}

export interface ListSprintsResult {
  projectKey: string;
  filter: {
    state: SprintStateFilter;
    boardName: string | null;
    maxResultsPerBoard: number;
  };
  sprints: SprintSummary[];
}

export interface ListProjectAssignableUsersInput {
  projectKey: string;
  maxResults: number;
  startAt?: number;
}

export interface ListProjectAssignableUsersResult {
  projectKey: string;
  activeOnly: true;
  maxResults: number;
  startAt: number;
  users: AssignableUser[];
}

export interface AssignIssueToSprintInput extends IssueReadOptions {
  issueKey: string;
  sprintId?: number;
  sprintName?: string;
  projectKey?: string;
  boardName?: string;
  loadIssueAfterAssign?: boolean;
}

export interface AssignIssueToSprintResult {
  issueKey: string;
  sprint: SprintSummary;
  issue?: FocusedIssue;
}

export type BusinessFieldName =
  | "summary"
  | "description"
  | "fixVersions"
  | "affectedVersions"
  | "labels"
  | "priority"
  | "severity";

export type BaselineSectionName =
  | "project"
  | "issueTypes"
  | "priorities"
  | "versions"
  | "assignableUsers"
  | "severity"
  | "fieldProfile"
  | "activeSprints"
  | "workflowStatuses"
  | "workflowTransitions";

export type BaselineSectionState = "ok" | "partial" | "unavailable";

export interface ProjectBaseline {
  project: {
    id: string;
    key: string;
    name: string;
  };
  issueTypes: Array<{
    id: string;
    name: string;
    description: string;
    subtask: boolean;
  }>;
  priorities: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  versions: Array<{
    id: string;
    name: string;
    released: boolean;
    archived: boolean;
    releaseDate: string | null;
  }>;
  assignableUsers: AssignableUser[];
  activeSprints: SprintSummary[];
  severity: {
    configured: boolean;
    fieldId: string | null;
    jqlField: string;
    valueType: "option" | "string" | "number";
    options: Array<{
      id: string | null;
      value: string;
      description: string;
    }>;
  };
  fieldProfile: Array<{
    issueType: {
      id: string;
      name: string;
    };
    fields: Array<{
      field: BusinessFieldName;
      required: boolean;
      supported: boolean;
      allowedValues: string[];
    }>;
  }>;
  workflow: {
    issueTypeFlows: Array<{
      issueType: {
        id: string;
        name: string;
      };
      statuses: Array<{
        id: string;
        name: string;
        category: string | null;
      }>;
      transitions: Array<{
        from: string;
        to: string;
        transition: string;
      }>;
      coverage: {
        statusesTotal: number;
        statusesWithSample: number;
        statusesWithTransitions: number;
      };
    }>;
  };
  integrity: {
    status: "complete" | "partial";
    sections: Array<{
      section: BaselineSectionName;
      state: BaselineSectionState;
      message: string | null;
    }>;
  };
  notes: string[];
}
