import { invoke } from "@tauri-apps/api/core";
import { Box, Settings } from "lucide-react";
import { useEffect, useState } from "react";

interface HealthStatus {
  app: string;
  version: string;
  platform: string;
}

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    void invoke<HealthStatus>("app_health")
      .then(setHealth)
      .catch(() => setHealthError(true));
  }, []);

  return (
    <div className="app-shell">
      <aside className="tool-rail">
        <div className="brand">
          <span className="brand-mark"><Box size={16} /></span>
          <strong>CTFBox</strong>
        </div>
        <nav aria-label="工具导航">
          <span className="nav-label">工作台</span>
          <button className="nav-item nav-item-active" type="button">开始</button>
        </nav>
        <button className="settings-link" type="button">
          <Settings size={15} />
          设置
        </button>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>CTFBox 工作台</h1>
            <p>桌面应用基础环境</p>
          </div>
          <span className={health ? "health health-ok" : "health"}>
            {health ? "后端已连接" : healthError ? "浏览器预览" : "正在连接"}
          </span>
        </header>
        <section className="empty-state">
          <Box size={28} />
          <h2>基础工程已就绪</h2>
          <p>
            {health
              ? `${health.app} ${health.version} · ${health.platform}`
              : "工具插件将在下一阶段接入。"}
          </p>
        </section>
      </main>
    </div>
  );
}

export default App;
