export { atomicWriteFile } from "./atomicWrite";
export {
  type BackupEntry,
  backupFileName,
  listBackups,
  MAX_BACKUPS,
  parseBackupName,
  pruneBackups,
  resolveBackupPath,
  writeBackup,
} from "./backups";
export {
  BackupInfo,
  MediaImport,
  MediaProbe,
  type ProjectContracts,
  type ProjectHandlers,
  ProjectListEntry,
  projectContracts,
  projectEvents,
  projectMediaContracts,
  RecoveryInfo,
  TrimClip,
  TrashedProjectEntry,
} from "./contracts";
export {
  errnoCode,
  type FsErrorCode,
  FsIpcError,
  type IpcErrorShape,
  isFsIpcError,
} from "./errors";
export type { FsLike } from "./fsTypes";
export {
  checkRelink,
  createProjectHandlers,
  documentDurationMs,
  documentId,
  documentModifiedMs,
  TRASH_DIR,
  TRASH_MARKER,
  type ProjectDeps,
  RELINK_DURATION_TOLERANCE_MS,
  type RelinkMismatch,
  stampDocument,
  type ValidationResult,
} from "./handlers";
export {
  BACKUPS_DIR,
  CACHE_DIR,
  EXPORTS_DIR,
  isWithin,
  MEDIA_DIR,
  numberedName,
  PROJECT_EXT,
  PROJECT_FILE,
  pathExists,
  requireAbsolute,
  requireName,
  requireProjectPath,
  resolveWithin,
  resolveWithinSync,
  sanitizeName,
  splitExt,
  THUMBNAIL_FILE,
  uniqueName,
} from "./paths";
export { createJsonRecentsStore, MAX_RECENTS, type RecentsStore, touchRecents } from "./recents";
export {
  createFilmstripService,
  DEFAULT_THUMB_HEIGHT,
  DEFAULT_THUMB_INTERVAL_MS,
  type FilmstripItem,
  type FilmstripService,
  THUMBS_INDEX,
  THUMBS_REL_DIR,
} from "./filmstrip";
export { type FfmpegDeps, requireFfmpeg, resolveVideoSource } from "./mediaTools";
export {
  createProxyService,
  type EnsureProxyResult,
  needsProxy,
  PROXY_REL_PATH,
  type ProxyProgressEvent,
  type ProxyService,
} from "./proxy";
export {
  type ClipLike,
  estimateTrimOffsetMs,
  purgeTrimTrash,
  restoreTrimmedSource,
  rewriteClips,
  TRIM_MANIFEST,
  TRIM_TRASH_DIR,
  trimSource,
  type TrimDeps,
  type TrimRequest,
  type TrimResponse,
} from "./trimSource";
