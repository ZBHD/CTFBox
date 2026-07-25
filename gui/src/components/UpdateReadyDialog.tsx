import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef } from "react";

export interface UpdateReadyDialogProps {
  version: string;
  busy?: boolean;
  onPostpone: () => void;
  onRestart: () => void;
}

interface FocusTarget {
  focus: () => void;
  isConnected?: boolean;
}

function currentFocusTarget(): FocusTarget | null {
  if (typeof document === "undefined") return null;
  const activeElement = document.activeElement as (Element & Partial<FocusTarget>) | null;
  return activeElement && typeof activeElement.focus === "function"
    ? activeElement as FocusTarget
    : null;
}

function shouldRestorePreviousFocus(): boolean {
  if (typeof document === "undefined") return false;
  const activeElement = document.activeElement as (Element & { isConnected?: boolean }) | null;
  return activeElement === null
    || activeElement === document.body
    || activeElement.isConnected === false;
}

export function UpdateReadyDialog({
  version,
  busy = false,
  onPostpone,
  onRestart,
}: UpdateReadyDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const postponeRef = useRef<HTMLButtonElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<FocusTarget | null>(currentFocusTarget());
  const mounted = useRef(false);
  const actionLocked = useRef(false);
  const busyRef = useRef(busy);
  const postponeAction = useRef(onPostpone);

  busyRef.current = busy;
  postponeAction.current = onPostpone;

  const runAction = (action: () => void) => {
    if (busyRef.current || actionLocked.current) return;
    actionLocked.current = true;
    try {
      action();
    } catch (error) {
      actionLocked.current = false;
      throw error;
    }
  };

  useEffect(() => {
    mounted.current = true;

    if (typeof document === "undefined") {
      return () => {
        mounted.current = false;
      };
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) runAction(postponeAction.current);
        return;
      }

      if (event.key !== "Tab") return;
      const activeElement = document.activeElement;
      const postponeButton = postponeRef.current;
      const restartButton = restartRef.current;

      if (busyRef.current || actionLocked.current) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && activeElement === postponeButton) {
        event.preventDefault();
        restartButton?.focus();
      } else if (!event.shiftKey && activeElement === restartButton) {
        event.preventDefault();
        postponeButton?.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(event.target as Node)) return;
      if (busyRef.current || actionLocked.current) dialog.focus();
      else restartRef.current?.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      mounted.current = false;
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      // StrictMode immediately mounts the effect again; defer so that pass does not steal focus.
      queueMicrotask(() => {
        const target = previousFocus.current;
        if (!mounted.current && target?.isConnected !== false && shouldRestorePreviousFocus()) {
          target?.focus();
        }
      });
    };
  }, []);

  return (
    <div className="update-ready-backdrop">
      <div
        ref={dialogRef}
        className="update-ready-dialog"
        role="dialog"
        aria-modal={true}
        aria-labelledby="update-ready-title"
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <div className="update-ready-heading">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <h2 id="update-ready-title">更新已准备好</h2>
            <span className="update-ready-version">v{version}</span>
          </div>
        </div>
        <p>更新已经过验证，将在重启时完成安装。</p>
        <div className="update-ready-actions">
          <button
            ref={postponeRef}
            className="update-ready-secondary"
            type="button"
            disabled={busy}
            onClick={() => runAction(onPostpone)}
          >
            稍后重启
          </button>
          <button
            ref={restartRef}
            className="update-ready-primary"
            type="button"
            disabled={busy}
            autoFocus
            onClick={() => runAction(onRestart)}
          >
            立即重启
          </button>
        </div>
      </div>
    </div>
  );
}
