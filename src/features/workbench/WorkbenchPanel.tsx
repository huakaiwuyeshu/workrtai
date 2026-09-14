import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

type Pane = { paneId: string; sessionId: string; parentPaneId?: string | null; title: string; focused: boolean };

export function WorkbenchPanel() {
  const [open, setOpen] = useState(false);
  const [panes, setPanes] = useState<Pane[]>([]);
  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try { setPanes(await invoke<Pane[]>("workbench_list_panes")); } catch { /* feature unavailable during web preview */ }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const focus = async (paneId: string) => { if (isTauri()) await invoke("workbench_focus_pane", { paneId }); await refresh(); };
  return <aside className={`workbench-panel ${open ? "is-open" : ""}`} aria-label="Agent 工作台">
    <button className="workbench-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>◈ Agent 工作台</button>
    {open && <div className="workbench-panel__body">
      <header><strong>任务与 Session</strong><button onClick={() => void refresh()}>刷新</button></header>
      {panes.length === 0 ? <p className="workbench-empty">暂无绑定的 Agent Session</p> : <ul>{panes.map((pane) => <li key={pane.paneId} className={pane.focused ? "is-focused" : ""}><button onClick={() => void focus(pane.paneId)}><span>{pane.title}</span><small>{pane.sessionId}</small></button><i>{pane.focused ? "运行中" : "待命"}</i></li>)}</ul>}
      <footer>子 Agent 完成后会自动回传任务状态；可在主 Session 中继续追问。</footer>
    </div>}
  </aside>;
}
