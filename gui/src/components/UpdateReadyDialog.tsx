import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

export interface UpdateReadyDialogProps {
  version: string;
  onPostpone: () => void;
  onRestart: () => void;
}

interface FocusTarget {
  focus: () => void;
}

function currentFocusTarget(): FocusTarget | null {
  if (typeof document === "undefined") return null;
  const activeElement = document.activeElement as (Element & Partial<FocusTarget>) | null;
  return activeElement && typeof activeElement.focus === "function"
    ? activeElement as FocusTarget
    : null;
}

export function UpdateReadyDialog({ version, onPostpone, onRestart }: UpdateReadyDialogProps) {
  const previousFocus = useRef<FocusTarget | null>(currentFocusTarget());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode immediately mounts the effect again; defer so that pass does not steal focus.
      queueMicrotask(() => {
        if (!mounted.current) previousFocus.current?.focus();
      });
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onPostpone();
  };

  return (
    <div className="update-ready-backdrop">
      <div
        className="update-ready-dialog"
        role="dialog"
        aria-modal={true}
        aria-labelledby="update-ready-title"
        onKeyDown={handleKeyDown}
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
          <button className="update-ready-secondary" type="button" onClick={onPostpone}>
            稍后重启
          </button>
          <button className="update-ready-primary" type="button" autoFocus onClick={onRestart}>
            立即重启
          </button>
        </div>
      </div>
    </div>
  );
}
