import { Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  BUILT_IN_FLAG_PREFIXES,
  type FlagPrefixPreference,
} from "../lib/flagPrefixPreference";

interface FlagPrefixListProps {
  value: FlagPrefixPreference;
  onChange: (value: FlagPrefixPreference) => void;
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      className={`toggle flag-prefix-toggle ${checked ? "toggle-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

export function FlagPrefixList({ value, onChange }: FlagPrefixListProps) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const custom = useMemo(
    () => value.custom.filter((prefix) => !BUILT_IN_FLAG_PREFIXES.some((builtIn) => (
      builtIn.toLocaleLowerCase() === prefix.toLocaleLowerCase()
    ))),
    [value.custom],
  );
  const prefixes = useMemo(() => [...BUILT_IN_FLAG_PREFIXES, ...custom], [custom]);
  const enabled = useMemo(() => new Set(value.enabled), [value.enabled]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visiblePrefixes = normalizedQuery
    ? prefixes.filter((prefix) => prefix.toLocaleLowerCase().includes(normalizedQuery))
    : prefixes;
  const allEnabled = prefixes.length > 0 && prefixes.every((prefix) => enabled.has(prefix));

  const closeAdd = () => {
    setAdding(false);
    setDraft("");
    setError(undefined);
  };

  const addPrefix = () => {
    const prefix = draft.trim();
    if (!prefix) {
      setError("请输入检测头");
      return;
    }
    if (prefix.length > 64) {
      setError("检测头不能超过 64 个字符");
      return;
    }
    if (/[{},\s]/.test(prefix)) {
      setError("检测头不要包含逗号、花括号或空白");
      return;
    }
    if (prefixes.some((item) => item.toLocaleLowerCase() === prefix.toLocaleLowerCase())) {
      setError("该检测头已存在");
      return;
    }

    onChange({
      enabled: [...value.enabled, prefix],
      custom: [...custom, prefix],
    });
    closeAdd();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    addPrefix();
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") closeAdd();
    else if (event.key === "Enter") {
      event.preventDefault();
      addPrefix();
    }
  };

  return (
    <div className="flag-prefix-list-field">
      <div className="flag-prefix-list-heading">
        <div>
          <strong>检测头</strong>
          <span>{prefixes.length} 个检测头，命中时匹配后续花括号内容</span>
        </div>
        <button className="flag-prefix-add" type="button" onClick={() => { setAdding(true); setError(undefined); }}>
          <Plus size={13} />添加
        </button>
      </div>

      <div className="flag-prefix-tools">
        <label className="flag-prefix-search">
          <Search size={13} />
          <input
            aria-label="搜索 Flag 头"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Flag 头"
          />
        </label>
        <div className="flag-prefix-all">
          <span>{normalizedQuery ? `${visiblePrefixes.length} 个结果` : `${value.enabled.length} 个已启用`}</span>
          <label>全部启用</label>
          <Switch
            checked={allEnabled}
            label={allEnabled ? "禁用全部检测头" : "启用全部检测头"}
            onChange={() => onChange({
              enabled: allEnabled ? [] : [...prefixes],
              custom: [...custom],
            })}
          />
        </div>
      </div>

      {adding && (
        <form className="flag-prefix-create" onSubmit={submit}>
          <input
            autoFocus
            aria-label="自定义检测头"
            aria-invalid={error !== undefined}
            value={draft}
            maxLength={65}
            onChange={(event) => { setDraft(event.target.value); setError(undefined); }}
            onKeyDown={handleDraftKeyDown}
            placeholder="例如 TEAM"
          />
          <button type="submit">确认添加</button>
          <button className="flag-prefix-icon" type="button" aria-label="取消添加" title="取消添加" onClick={closeAdd}><X size={14} /></button>
          {error && <span className="flag-prefix-error" role="alert">{error}</span>}
        </form>
      )}

      <div className="flag-prefix-items" aria-label="Flag 检测头列表">
        {visiblePrefixes.map((prefix) => {
          const isEnabled = enabled.has(prefix);
          const isCustom = custom.includes(prefix);
          return (
            <div className="flag-prefix-item" key={prefix}>
              <code>{prefix}</code>
              <div className="flag-prefix-actions">
                {isCustom && (
                  <button
                    className="flag-prefix-icon"
                    type="button"
                    aria-label={`删除 ${prefix}`}
                    title={`删除 ${prefix}`}
                    onClick={() => onChange({
                      enabled: value.enabled.filter((item) => item !== prefix),
                      custom: custom.filter((item) => item !== prefix),
                    })}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
                <Switch
                  checked={isEnabled}
                  label={`${isEnabled ? "禁用" : "启用"} ${prefix}`}
                  onChange={() => onChange({
                    enabled: isEnabled
                      ? value.enabled.filter((item) => item !== prefix)
                      : [...value.enabled, prefix],
                    custom: [...custom],
                  })}
                />
              </div>
            </div>
          );
        })}
        {visiblePrefixes.length === 0 && <div className="flag-prefix-empty">没有匹配的检测头</div>}
      </div>
    </div>
  );
}
