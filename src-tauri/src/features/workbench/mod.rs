use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspanPane {
    pub pane_id: String,
    pub session_id: String,
    pub parent_pane_id: Option<String>,
    pub title: String,
    pub focused: bool,
}

pub struct WorkbenchState(pub Mutex<Vec<WorkspanPane>>, PathBuf);

impl WorkbenchState {
    pub fn load(path: PathBuf) -> Self {
        let panes = fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
        Self(Mutex::new(panes), path)
    }
    fn save(&self, panes: &[WorkspanPane]) { if let Some(parent) = self.1.parent() { let _ = fs::create_dir_all(parent); } if let Ok(text) = serde_json::to_string_pretty(panes) { let _ = fs::write(&self.1, text); } }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePaneRequest {
    pub pane_id: String,
    pub session_id: String,
    pub parent_pane_id: Option<String>,
    pub title: Option<String>,
}

#[tauri::command]
pub fn workbench_list_panes(state: State<'_, WorkbenchState>) -> Result<Vec<WorkspanPane>, String> {
    state.0.lock().map(|items| items.clone()).map_err(|_| "workbench_state_poisoned".into())
}

#[tauri::command]
pub fn workbench_create_pane(state: State<'_, WorkbenchState>, request: CreatePaneRequest) -> Result<WorkspanPane, String> {
    let mut items = state.0.lock().map_err(|_| "workbench_state_poisoned")?;
    if items.iter().any(|pane| pane.pane_id == request.pane_id) { return Err("workbench_pane_exists".into()); }
    let pane = WorkspanPane { pane_id: request.pane_id, session_id: request.session_id, parent_pane_id: request.parent_pane_id, title: request.title.unwrap_or_else(|| "Agent".into()), focused: true };
    for item in items.iter_mut() { item.focused = false; }
    items.push(pane.clone());
    state.save(&items);
    Ok(pane)
}

#[tauri::command]
pub fn workbench_focus_pane(state: State<'_, WorkbenchState>, pane_id: String) -> Result<WorkspanPane, String> {
    let mut items = state.0.lock().map_err(|_| "workbench_state_poisoned")?;
    let index = items.iter().position(|pane| pane.pane_id == pane_id).ok_or("workbench_pane_not_found")?;
    for item in items.iter_mut() { item.focused = false; }
    items[index].focused = true;
    state.save(&items);
    Ok(items[index].clone())
}

#[tauri::command]
pub fn workbench_remove_pane(state: State<'_, WorkbenchState>, pane_id: String) -> Result<(), String> {
    let mut items = state.0.lock().map_err(|_| "workbench_state_poisoned")?;
    items.retain(|pane| pane.pane_id != pane_id);
    state.save(&items);
    Ok(())
}

#[tauri::command]
pub fn workbench_tasks(state: State<'_, WorkbenchState>) -> Result<serde_json::Value, String> {
    let path = state.1.parent().unwrap_or_else(|| std::path::Path::new(".")).join("tasks.snapshot.json");
    let text = fs::read_to_string(path).unwrap_or_else(|_| "[]".into());
    serde_json::from_str(&text).map_err(|_| "workbench_tasks_snapshot_invalid".into())
}
