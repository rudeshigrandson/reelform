export type ProjectState = "ready" | "recording" | "interrupted";

export interface ProjectSummary {
  id: string;
  name: string;
  thumbnailUrl?: string;
  /** ISO 8601 timestamp of last modification. */
  modifiedAt: string;
  durationMs: number;
  state?: ProjectState;
}

export type CardAction = "rename" | "duplicate" | "delete";

export type SortKey = "recent" | "name";

export interface ProjectBrowserProps {
  projects: ReadonlyArray<ProjectSummary>;
  onOpen: (id: string) => void;
  onNew: () => void;
  onImport?: () => void;
  onCardAction: (id: string, action: CardAction) => void;
}

/** Sample fixture for stories / manual testing. */
export const sampleProjects: ReadonlyArray<ProjectSummary> = [
  {
    id: "p1",
    name: "Onboarding walkthrough",
    modifiedAt: "2026-09-14T09:30:00.000Z",
    durationMs: 132_000,
    state: "ready",
  },
  {
    id: "p2",
    name: "Dashboard demo",
    modifiedAt: "2026-09-12T18:05:00.000Z",
    durationMs: 47_500,
    state: "ready",
  },
  {
    id: "p3",
    name: "Bug repro capture",
    modifiedAt: "2026-09-13T11:20:00.000Z",
    durationMs: 8_200,
    state: "interrupted",
  },
  {
    id: "p4",
    name: "Live feature tour",
    modifiedAt: "2026-09-14T08:00:00.000Z",
    durationMs: 0,
    state: "recording",
  },
];
