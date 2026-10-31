export interface Account {
  id: string;
  provider: string;
  host: string;
  userId: number;
  login: string;
  name: string;
  avatar: string;
  note: string;
  color: string;
  status: string;
  sessionOnly: boolean;
  syncedAt: string;
}
export interface Profile {
  id: string;
  accountId: string;
  name: string;
  email: string;
}
export interface Repository {
  id: string;
  owner: string;
  name: string;
  description: string;
  cloneUrl: string;
  url: string;
  private: boolean;
  language: string;
  updatedAt: string;
  favorite: boolean;
  lastOpened?: string;
}
export interface Access {
  id: string;
  accountId: string;
  repositoryId: string;
  push: boolean;
  syncedAt: string;
}
export interface Checkout {
  plainDirectory?: boolean;
  commitName?: string;
  commitEmail?: string;
  id: string;
  path: string;
  name: string;
  repositoryId: string;
  lastOpened: string;
  favorite: boolean;
  remotes: { name: string; url: string; pushUrl?: string }[];
}
export interface Binding {
  automatic?: boolean;
  id: string;
  checkoutId: string;
  remote: string;
  accountId: string;
  profileId: string;
}
export interface Group {
  id: string;
  name: string;
  members: string[];
}
export interface Task {
  id: string;
  kind: string;
  target: string;
  state: string;
  progress: string;
  errorCode: string;
  error: string;
  startedAt: string;
  finishedAt: string;
  logs?: { at: string; message: string }[];
  canResumeAuthorization?: boolean;
  authorizationRecoveryExpiresAt?: string;
  cloneRequest?: { accountId: string; profileId: string; destination: string; url?: string };
  scanSummary?: {
    imported: number;
    skipped: number;
    issues: { path: string; code: string }[];
  };
}
export interface Settings {
  defaultAccountId?: string;
  defaultCommitName?: string;
  defaultCommitEmail?: string;
  clientId: string;
  gitPath: string;
  cloneDirectory: string;
  editorPath: string;
  autoUpdateDisabled: boolean;
}
export interface State {
  githubAuthConfigured?: boolean;
  accounts: Account[];
  profiles: Profile[];
  repositories: Repository[];
  access: Access[];
  checkouts: Checkout[];
  bindings: Binding[];
  groups: Group[];
  tasks: Task[];
  settings: Settings;
  pendingCredentialCleanupCount?: number;
}
export interface Authorization {
  taskId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}
export interface Email {
  email: string;
  primary: boolean;
  verified: boolean;
}
export interface FileStatus {
  path: string;
  originalPath: string;
  index: string;
  worktree: string;
  tracked?: boolean;
  indexAdditions?: number;
  indexDeletions?: number;
  worktreeAdditions?: number;
  worktreeDeletions?: number;
}
export interface RemoteTracking {
  remote: string;
  branch: string;
  ahead: number;
  behind: number;
}export interface RemoteCheck {
  remote: string;
  branch: string;
  head: string;
  tracking: string;
  updated: boolean;
}
export interface LineEndingRisk {
  path: string;
  crlf: number;
  lf: number;
  mixed: boolean;
  policy: string;
}
export interface WorkingFileInfo {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
  binary: boolean;
  encoding: string;
  lineEnding: string;
  mimeType: string;
  previewKind: "text" | "image" | "audio" | "video" | "unsupported" | "directory";
  editable: boolean;
  tooLarge: boolean;
}
export interface WorkingFilePreview {
  kind: "image" | "audio" | "video";
  mimeType: string;
  data: string;
  size: number;
}
export interface FileEntry {
  path: string;
  tracked: boolean;
}
export interface GitStatus {
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  files: FileStatus[];
  remotes: { name: string; url: string; pushUrl: string }[];
  tracking?: RemoteTracking[];
  detached: boolean;
}
export interface Commit {
  hash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  files: number;
  insertions: number;
  deletions: number;
}
export interface Branch {
  name: string;
  current: boolean;
}
export const emptyState: State = {
  accounts: [],
  profiles: [],
  repositories: [],
  access: [],
  checkouts: [],
  bindings: [],
  groups: [],
  tasks: [],
  settings: {
    clientId: "",
    gitPath: "git",
    cloneDirectory: "",
    editorPath: "",
    autoUpdateDisabled: false,
  },
};
