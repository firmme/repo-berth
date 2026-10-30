import type {
  State,
  Settings,
  Profile,
  Binding,
  Group,
  Authorization,
  Email,
  GitStatus,
  Commit,
  Branch,
  FileEntry,
} from "./types";
import { emptyState } from "./types";

type NativeHost = {
  chrome?: { webview?: { postMessage?: unknown } };
  webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
  wails?: { invoke?: unknown };
  _wails?: { environment?: { OS?: string } };
};
const native = (typeof window === "undefined"
  ? {}
  : window) as unknown as NativeHost;
export const isDesktop = Boolean(
  native.chrome?.webview?.postMessage ||
    native.webkit?.messageHandlers?.external?.postMessage ||
    native.wails?.invoke ||
    native._wails?.environment?.OS,
);
interface Methods {
  Snapshot: () => State;
  SaveSettings: (settings: Settings) => void;
  GitVersion: () => string;
  PickDirectory: () => string;
  StartAuthorization: (
    sessionOnly: boolean,
    reauthorizeID: string,
  ) => Authorization;
  AccountEmails: (id: string) => Email[];
  RecoverAuthorization: (taskID: string, sessionOnly: boolean) => string;
  RetryCredentialCleanup: () => string;
  OpenGitHubPage: (kind: string) => void;
  UpdateAccount: (id: string, note: string, color: string) => void;
  RemoveAccount: (id: string) => void;
  SaveProfile: (profile: Profile) => string;
  DeleteProfile: (id: string) => void;
  SyncRepositories: (id: string) => string;
  ImportCheckout: (path: string) => string;
  ImportPlainDirectory: (path: string) => string;
  ForgetCheckouts: (ids: string[]) => void;
  SetCheckoutIdentity: (id: string, name: string, email: string) => void;
  ForgetCheckout: (id: string) => void;
  ScanDirectory: (path: string) => string;
  BindRepository: (binding: Binding) => void;
  SetAccessAccount: (
    checkoutID: string,
    remote: string,
    accountID: string,
  ) => void;
  CloneRepository: (
    repoID: string,
    accountID: string,
    profileID: string,
    dest: string,
  ) => string;
  CloneFromURL: (
    url: string,
    accountID: string,
    profileID: string,
    dest: string,
  ) => string;
  ShareRepository: (
    checkoutID: string,
    accountID: string,
    name: string,
    description: string,
    isPrivate: boolean,
  ) => string;
  ToggleFavorite: (id: string) => void;
  MarkVisited: (id: string) => void;
  SaveGroup: (group: Group) => string;
  DeleteGroup: (id: string) => void;
  ConvertRemoteHTTPS: (id: string, remote: string) => void;
  OpenCheckout: (id: string, kind: string) => void;
  OpenRepository: (id: string) => void;
  OpenCheckoutGitHub: (id: string, remote: string) => void;
  GitStatus: (id: string) => GitStatus;
  GitFiles: (id: string) => FileEntry[];
  GitDiff: (id: string, file: string, staged: boolean) => string;
  GitHistory: (id: string) => Commit[];
  GitCommitDiff: (id: string, hash: string) => string;
  GitBranches: (id: string) => Branch[];
  StageFile: (id: string, file: string, stage: boolean) => void;
  StageFiles: (id: string, files: string[], stage: boolean) => void;
  GitFileContent: (id: string, file: string) => string;
  SaveWorkingFile: (id: string, file: string, content: string) => void;
  CreateWorkingFile: (id: string, file: string) => void;
  AddToGitignore: (id: string, file: string, directory: boolean) => void;
  UntrackFile: (id: string, file: string, recursive: boolean) => void;
  CommitChanges: (id: string, remote: string, message: string) => string;
  SwitchBranch: (id: string, name: string, create: boolean) => string;
  GitNetwork: (id: string, remote: string, operation: string) => string;
  CancelTask: (id: string) => void;
  CheckForUpdates: () => void;
}
export async function api<K extends keyof Methods>(
  name: K,
  ...args: Parameters<Methods[K]>
): Promise<ReturnType<Methods[K]>> {
  if (!isDesktop) {
    if (name === "Snapshot")
      return structuredClone(emptyState) as ReturnType<Methods[K]>;
    throw new Error("DESKTOP_REQUIRED: 此操作需要在 Repo Berth 桌面应用中执行");
  }
  const { Call } = await import("@wailsio/runtime");
  return Call.ByName(`repo-berth/internal/service.Service.${name}`, ...args);
}
export async function onStateChanged(
  callback: () => void,
  onTaskFinished?: () => void,
): Promise<() => void> {
  if (!isDesktop) return () => {};
  const { Events } = await import("@wailsio/runtime");
  const offState = Events.On("state:changed", callback);
  const offTask = Events.On("task:updated", (event) => {
    const task = event.data as { state?: string };
    if (task && task.state !== "running" && task.state !== "queued")
      onTaskFinished?.();
  });
  return () => {
    offState();
    offTask();
  };
}
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String(e.message);
  return "操作失败，请重试";
}
