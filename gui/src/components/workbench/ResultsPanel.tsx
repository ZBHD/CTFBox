import { ListTree } from "lucide-react";
import type { FlagHit } from "../../lib/flagDetector";
import type { StructuredFinding, TaskSuggestion } from "../../state/taskStore";

interface ResultsPanelProps {
  findings: StructuredFinding[];
  suggestions: TaskSuggestion[];
  flagEnabled: boolean;
  flagPrefixes: string[];
  flagHits?: FlagHit[];
}

function highlightFlag(value: string, enabled: boolean, prefixes: string[]) {
  if (!enabled || prefixes.length === 0) return value;
  const escaped = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")}\\{[^}]+\\})`, "ig");
  return value.split(pattern).map((part, index) =>
    pattern.test(part) ? <mark key={`${part}-${index}`}>{part}</mark> : part,
  );
}

export function ResultsPanel({ findings, suggestions, flagEnabled, flagPrefixes, flagHits = [] }: ResultsPanelProps) {
  return (
    <section className="results-panel">
      <header className="panel-header">
        <div className="panel-title"><ListTree size={15} /><h2>结构化结果</h2></div>
        <span className="result-count">{findings.length}</span>
      </header>
      <div className="results-content">
        {flagHits.length > 0 && <div className="flag-findings">
          {flagHits.map((hit, index) => <div className="flag-finding" key={`${hit.source}-${hit.text}-${index}`}><mark>{hit.text}</mark>{hit.source === "base64" && <span>Base64</span>}</div>)}
        </div>}
        {findings.length === 0 && flagHits.length === 0 ? (
          <div className="results-empty"><span>暂无结果</span><small>运行后将从回显中提取可用字段</small></div>
        ) : findings.map((finding, index) => (
          <div className="finding-row" key={`${finding.kind}-${index}`}>
            <span>{finding.kind}</span>
            <strong>{highlightFlag(finding.value, flagEnabled, flagPrefixes)}</strong>
          </div>
        ))}
        {suggestions.length > 0 && (
          <div className="suggestions">
            <span>下一步</span>
            {suggestions.map((item) => <button type="button" key={item.id}>{item.label}</button>)}
          </div>
        )}
      </div>
    </section>
  );
}
