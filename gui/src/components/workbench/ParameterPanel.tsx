import { FileUp, SlidersHorizontal } from "lucide-react";
import type { ToolParameters } from "../../lib/commandBuilder";

interface ParameterPanelProps {
  toolId: string;
  mode?: string;
  parameters: ToolParameters;
  onChange: (name: string, value: string | boolean) => void;
}

const MODE_NAMES: Record<string, string> = {
  encoding: "编码转换",
  hash: "哈希识别",
  xor: "异或分析",
  "fake-encryption": "伪加密",
  lsb: "LSB 隐写",
  image: "图片隐写",
  audio: "音频隐写",
};

function Field({ label, name, value, placeholder, onChange }: {
  label: string;
  name: string;
  value: string;
  placeholder: string;
  onChange: ParameterPanelProps["onChange"];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(name, event.target.value)} />
    </label>
  );
}

function Check({ label, name, checked, onChange }: {
  label: string;
  name: string;
  checked: boolean;
  onChange: ParameterPanelProps["onChange"];
}) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(name, event.target.checked)} />
      <span className="check-box" />
      <span>{label}</span>
    </label>
  );
}

export function ParameterPanel({ toolId, mode, parameters, onChange }: ParameterPanelProps) {
  return (
    <section className="parameter-panel">
      <header className="panel-header">
        <div className="panel-title"><SlidersHorizontal size={15} /><h2>任务参数</h2></div>
      </header>
      <div className="parameter-content">
        {toolId === "sqlmap" && (
          <>
            <Field label="目标 URL" name="url" value={String(parameters.url ?? "")} placeholder="http://127.0.0.1/item?id=1" onChange={onChange} />
            <div className="control-group">
              <span className="control-label">枚举范围</span>
              <Check label="数据库" name="database" checked={Boolean(parameters.database)} onChange={onChange} />
              <Check label="数据表" name="tables" checked={Boolean(parameters.tables)} onChange={onChange} />
              <Check label="字段列" name="columns" checked={Boolean(parameters.columns)} onChange={onChange} />
            </div>
            <div className="control-group">
              <span className="control-label">运行选项</span>
              <Check label="自动确认 (--batch)" name="batch" checked={Boolean(parameters.batch)} onChange={onChange} />
            </div>
          </>
        )}
        {toolId === "sstimap" && (
          <>
            <Field label="目标 URL" name="url" value={String(parameters.url ?? "")} placeholder="http://127.0.0.1/page?name=test" onChange={onChange} />
            <Field label="请求数据" name="payload" value={String(parameters.payload ?? "")} placeholder="name={{7*7}}" onChange={onChange} />
          </>
        )}
        {(toolId === "crypto" || toolId === "misc") && (
          <>
            <div className="selected-module">
              <span>当前模块</span>
              <strong>{MODE_NAMES[mode ?? ""] ?? "请选择工具"}</strong>
            </div>
            <label className="field">
              <span>{toolId === "crypto" && mode === "encoding" ? "输入文本" : "输入文件"}</span>
              <div className="file-field">
                <input value={String(parameters.input ?? "")} placeholder={toolId === "crypto" && mode === "encoding" ? "粘贴待处理文本" : "选择或输入文件路径"} onChange={(event) => onChange("input", event.target.value)} />
                <button type="button" title="选择文件"><FileUp size={15} /></button>
              </div>
            </label>
            <div className="control-group">
              <span className="control-label">处理方式</span>
              <Check label="自动识别" name="auto" checked={parameters.auto !== false} onChange={onChange} />
              <Check label="保留中间结果" name="intermediate" checked={Boolean(parameters.intermediate)} onChange={onChange} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
