import { open } from "@tauri-apps/plugin-dialog";
import { Check, ChevronDown, FileUp, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type { ToolParameters } from "../../lib/commandBuilder";
import { getToolSchema, type ParameterField, type ParameterOption } from "../../lib/toolSchemas";
import type { StructuredFinding } from "../../state/taskStore";

interface ParameterPanelProps {
  toolId: string;
  mode?: string;
  parameters: ToolParameters;
  findings?: StructuredFinding[];
  onChange: (name: string, value: string | boolean) => void;
  openFileDialog?: () => Promise<string | null>;
}

const openSingleFile = () => open({ directory: false, multiple: false });

function formatExamplePlaceholder(field: ParameterField) {
  if (!field.placeholder) return undefined;
  if (field.control === "file" || field.control === "result-select") return field.placeholder;
  return `例如：${field.placeholder}`;
}

function ChoiceField({
  value,
  options,
  placeholder = "未指定",
  onChange,
}: {
  value: string;
  options: readonly ParameterOption[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div className={`choice-field ${open ? "choice-field-open" : ""}`}>
      <button type="button" className="choice-trigger" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={selected ? "" : "choice-placeholder"}>{(selected?.label ?? value) || placeholder}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="choice-menu" role="listbox">
          <button type="button" className={!value ? "choice-option active" : "choice-option"} onClick={() => { onChange(""); setOpen(false); }}>
            <span>{placeholder}</span>{!value && <Check size={12} />}
          </button>
          {options.map((option) => (
            <button type="button" className={value === option.value ? "choice-option active" : "choice-option"} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>
              <span>{option.label}</span>{value === option.value && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BooleanField({ field, checked, onChange }: { field: ParameterField; checked: boolean; onChange: ParameterPanelProps["onChange"] }) {
  return (
    <label className="parameter-toggle-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(field.id, event.target.checked)} />
      <span className="check-box" />
      <span className="parameter-label"><strong>{field.label}</strong><code>{field.flag}</code></span>
    </label>
  );
}

function ParameterControl({
  field,
  value,
  findings,
  onChange,
  openFileDialog,
}: {
  field: ParameterField;
  value: string | boolean | number | undefined;
  findings: StructuredFinding[];
  onChange: ParameterPanelProps["onChange"];
  openFileDialog: () => Promise<string | null>;
}) {
  if (field.control === "boolean") {
    return <BooleanField field={field} checked={Boolean(value)} onChange={onChange} />;
  }

  if (field.control === "multiselect") {
    const selected = String(value ?? "");
    return (
      <div className="parameter-field parameter-field-wide">
        <div className="parameter-field-label"><strong>{field.label}</strong><code>{field.flag}</code></div>
        <div className="chip-options">
          {field.options?.map((option) => {
            const active = selected.includes(option.value);
            return <button type="button" className={active ? "chip-option active" : "chip-option"} key={option.value} onClick={() => onChange(field.id, active ? selected.replace(option.value, "") : `${selected}${option.value}`)}>{option.value}<span>{option.label}</span></button>;
          })}
        </div>
      </div>
    );
  }

  const resultValues = field.resultKind
    ? findings.filter((finding) => finding.kind === field.resultKind).map((finding) => finding.value)
    : [];
  const resultOptions = Array.from(new Set(resultValues)).map((item) => ({ value: item, label: item }));
  const commonLabel = <div className="parameter-field-label"><strong>{field.label}</strong><code>{field.flag}</code></div>;

  if (field.control === "select" || (field.control === "result-select" && resultOptions.length > 0)) {
    return (
      <div className="parameter-field">
        {commonLabel}
        <ChoiceField
          value={String(value ?? "")}
          options={field.control === "select" ? field.options ?? [] : resultOptions}
          placeholder={field.placeholder}
          onChange={(next) => onChange(field.id, next)}
        />
      </div>
    );
  }

  if (field.control === "textarea") {
    return (
      <label className="parameter-field parameter-field-wide">
        {commonLabel}
        <textarea value={String(value ?? "")} placeholder={formatExamplePlaceholder(field)} rows={3} onChange={(event) => onChange(field.id, event.target.value)} />
      </label>
    );
  }

  return (
    <label className="parameter-field">
      {commonLabel}
      <div className={field.control === "file" ? "file-field" : undefined}>
        <input
          type={field.control === "number" ? "number" : "text"}
          value={String(value ?? "")}
          min={field.min}
          max={field.max}
          placeholder={formatExamplePlaceholder(field)}
          onChange={(event) => onChange(field.id, event.target.value)}
        />
        {field.control === "file" && (
          <button
            type="button"
            title="选择文件"
            onClick={async () => {
              const selected = await openFileDialog();
              if (selected) onChange(field.id, selected);
            }}
          >
            <FileUp size={14} />
          </button>
        )}
      </div>
    </label>
  );
}

export function ParameterPanel({ toolId, parameters, findings = [], onChange, openFileDialog = openSingleFile }: ParameterPanelProps) {
  const schema = getToolSchema(toolId);
  const [activeGroup, setActiveGroup] = useState("quick");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFields = useMemo(() => {
    if (normalizedQuery) {
      return schema.fields.filter((field) => `${field.label} ${field.flag} ${field.description ?? ""}`.toLowerCase().includes(normalizedQuery));
    }
    if (activeGroup === "quick") return schema.fields.filter((field) => field.quick);
    return schema.fields.filter((field) => field.group === activeGroup);
  }, [activeGroup, normalizedQuery, schema]);

  const discovered = (kind: "database" | "table" | "column") =>
    new Set(findings.filter((item) => item.kind === kind).map((item) => item.value)).size;

  return (
    <section className="parameter-panel">
      <header className="panel-header parameter-panel-header">
        <div className="panel-title"><SlidersHorizontal size={15} /><h2>任务参数</h2></div>
        <span className="parameter-total">{schema.fields.length} 项</span>
      </header>

      <div className="parameter-search">
        <Search size={13} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索参数或命令标志" />
      </div>

      {toolId === "sqlmap" && (
        <div className="result-link-strip">
          {(["database", "table", "column"] as const).map((kind) => {
            const labels = { database: "数据库", table: "数据表", column: "字段列" };
            const count = discovered(kind);
            return <button type="button" key={kind} onClick={() => setActiveGroup("enumeration")}><span>{labels[kind]}</span><strong>{count ? `${count} 个已发现` : "等待枚举"}</strong></button>;
          })}
        </div>
      )}

      <nav className="parameter-groups" aria-label="参数分组">
        <button type="button" className={activeGroup === "quick" && !normalizedQuery ? "active" : ""} onClick={() => { setActiveGroup("quick"); setQuery(""); }}>常用</button>
        {schema.groups.map((group) => <button type="button" className={activeGroup === group.id && !normalizedQuery ? "active" : ""} key={group.id} onClick={() => { setActiveGroup(group.id); setQuery(""); }}>{group.label}</button>)}
      </nav>

      <div className="parameter-content">
        <div className="parameter-section-heading">
          <div>
            <strong>{normalizedQuery ? "搜索结果" : activeGroup === "quick" ? "常用参数" : schema.groups.find((group) => group.id === activeGroup)?.label}</strong>
            <span>{normalizedQuery ? `找到 ${visibleFields.length} 项` : activeGroup === "quick" ? "优先展示高频任务参数" : schema.groups.find((group) => group.id === activeGroup)?.description}</span>
          </div>
        </div>
        <div className="parameter-fields">
          {visibleFields.map((field) => <ParameterControl key={field.id} field={field} value={parameters[field.id]} findings={findings} onChange={onChange} openFileDialog={openFileDialog} />)}
          {visibleFields.length === 0 && <div className="parameter-no-results">没有匹配的参数</div>}
        </div>
      </div>
    </section>
  );
}
