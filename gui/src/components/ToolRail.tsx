import {
  Binary,
  Box,
  ChevronDown,
  CircleArrowUp,
  Code2,
  Database,
  FileSearch,
  Settings,
} from "lucide-react";
import { useState } from "react";

export interface ToolSelection {
  toolId: string;
  mode?: string;
}

interface ToolRailProps {
  selection: ToolSelection;
  settingsOpen: boolean;
  availableUpdateVersion?: string;
  onSelect: (selection: ToolSelection) => void;
  onOpenSettings: () => void;
  onOpenUpdate?: () => void;
}

const CRYPTO_TOOLS = [
  { id: "encoding", name: "编码转换", detail: "Base 系列与常用编码" },
  { id: "hash", name: "哈希识别", detail: "摘要识别与离线计算" },
  { id: "xor", name: "异或分析", detail: "单字节与循环密钥" },
];

const MISC_TOOLS = [
  { id: "fake-encryption", name: "伪加密", detail: "归档标记检测与修复" },
  { id: "lsb", name: "LSB 隐写", detail: "像素低位数据提取" },
  { id: "image", name: "图片隐写", detail: "图层、通道与附加数据" },
  { id: "audio", name: "音频隐写", detail: "频谱与波形数据分析" },
];

export function ToolRail({
  selection,
  settingsOpen,
  availableUpdateVersion,
  onSelect,
  onOpenSettings,
  onOpenUpdate = () => undefined,
}: ToolRailProps) {
  const [openMenu, setOpenMenu] = useState<"crypto" | "misc" | null>(null);

  const renderPicker = (
    id: "crypto" | "misc",
    label: string,
    tools: typeof CRYPTO_TOOLS,
    Icon: typeof Binary,
  ) => {
    const selectedTool = tools.find((tool) => tool.id === selection.mode);
    const active = selection.toolId === id;
    return (
      <div className={`tool-picker ${openMenu === id ? "tool-picker-open" : ""}`}>
        <button
          className={`tool-entry tool-picker-trigger ${active ? "tool-entry-active" : ""}`}
          type="button"
          aria-expanded={openMenu === id}
          onClick={() => setOpenMenu(openMenu === id ? null : id)}
        >
          <Icon size={16} />
          <span>
            <strong>{label}</strong>
            <small>{active && selectedTool ? selectedTool.name : "选择工具"}</small>
          </span>
          <ChevronDown className="picker-chevron" size={14} />
        </button>
        {openMenu === id && (
          <div className="tool-picker-menu" role="menu" aria-label={`${label} 工具`}>
            <div className="picker-menu-heading">
              <span>{label} 工具集</span>
              <small>{tools.length} 个内置模块</small>
            </div>
            {tools.map((tool) => (
              <button
                className={active && selection.mode === tool.id ? "picker-option picker-option-active" : "picker-option"}
                key={tool.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect({ toolId: id, mode: tool.id });
                  setOpenMenu(null);
                }}
              >
                <span className="picker-option-mark" />
                <span>
                  <strong>{tool.name}</strong>
                  <small>{tool.detail}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="tool-rail">
      <div className={`brand ${availableUpdateVersion ? "brand-update-available" : ""}`}>
        <span className="brand-mark"><Box size={17} /></span>
        <span className="brand-copy"><strong>CTFBox</strong><small>桌面工具台</small></span>
        {availableUpdateVersion && (
          <button
            className="brand-update"
            type="button"
            title={`发现新版本 v${availableUpdateVersion}`}
            aria-label={`发现新版本 v${availableUpdateVersion}`}
            onClick={onOpenUpdate}
          >
            <CircleArrowUp aria-hidden="true" size={16} />
          </button>
        )}
      </div>
      <nav aria-label="工具导航">
        <span className="nav-label">WEB 工具</span>
        <button
          className={`tool-entry ${selection.toolId === "sqlmap" && !settingsOpen ? "tool-entry-active" : ""}`}
          type="button"
          onClick={() => onSelect({ toolId: "sqlmap" })}
        >
          <Database size={16} />
          <span><strong>SQLmap</strong><small>SQL 注入</small></span>
        </button>
        <button
          className={`tool-entry ${selection.toolId === "sstimap" && !settingsOpen ? "tool-entry-active" : ""}`}
          type="button"
          onClick={() => onSelect({ toolId: "sstimap" })}
        >
          <Code2 size={16} />
          <span><strong>SSTImap</strong><small>模板注入</small></span>
        </button>

        <span className="nav-label nav-label-spaced">工具箱</span>
        {renderPicker("crypto", "Crypto", CRYPTO_TOOLS, Binary)}
        {renderPicker("misc", "Misc", MISC_TOOLS, FileSearch)}
      </nav>
      <button
        className={`settings-link ${settingsOpen ? "settings-link-active" : ""}`}
        type="button"
        onClick={onOpenSettings}
      >
        <Settings size={16} />
        <span>设置</span>
      </button>
    </aside>
  );
}
