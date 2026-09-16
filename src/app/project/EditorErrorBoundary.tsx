import { Button } from "@design/components";
import { type CSSProperties, Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence for the editor window: a render error anywhere below
 * would otherwise unmount the whole React root and leave the window blank.
 * Shows what failed with Try again (remounts the subtree) and Back to projects.
 */

export interface EditorErrorBoundaryProps {
  children: ReactNode;
  /** Called before the subtree remounts on Try again (e.g. re-open the project). */
  onRetry?: (() => void) | undefined;
  /** "Back to projects"; omitted → the button is hidden. */
  onBack?: (() => void) | undefined;
  /** Reporting hook (tests / diagnostics); the error is always logged. */
  onError?: ((error: unknown, info: ErrorInfo) => void) | undefined;
}

interface State {
  error: unknown;
  /** Bumped on Try again so the children remount from scratch. */
  generation: number;
}

const centerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-3)",
  width: "100%",
  height: "100%",
  padding: "var(--space-6)",
  background: "var(--bg-app)",
  color: "var(--text-2)",
  fontFamily: "var(--font-body)",
  textAlign: "center",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading)",
  fontWeight: 400,
  fontSize: "22px",
  color: "var(--text-1)",
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "An unexpected error occurred";
}

export class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, State> {
  override state: State = { error: null, generation: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    // `null`/`undefined` throws still count as a failure.
    return { error: error ?? new Error("Unknown render error") };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[editor] render failed", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private readonly retry = (): void => {
    this.props.onRetry?.();
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
  };

  override render(): ReactNode {
    const { error, generation } = this.state;
    if (error === null) {
      return (
        <ErrorBoundaryGeneration key={generation}>{this.props.children}</ErrorBoundaryGeneration>
      );
    }
    const { onBack } = this.props;
    return (
      <div style={centerStyle} role="alert">
        <h1 style={headingStyle}>Something went wrong in the editor</h1>
        <p style={{ margin: 0, maxWidth: "52ch" }}>{errorMessage(error)}</p>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {onBack && (
            <Button variant="secondary" onClick={onBack}>
              Back to projects
            </Button>
          )}
          <Button variant="primary" onClick={this.retry}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
}

/** Keyed wrapper: a new generation remounts the children instead of reusing crashed state. */
function ErrorBoundaryGeneration({ children }: { children: ReactNode }): ReactNode {
  return children;
}
