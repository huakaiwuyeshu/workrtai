use serde::{Deserialize, Serialize};
use std::sync::Mutex;
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

#[derive(Default)]
pub struct WorkbenchState(pub Mutex<Vec<WorkspanPane>>);

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
    Ok(pane)
}

#[tauri::command]
pub fn workbench_focus_pane(state: State<'_, WorkbenchState>, pane_id: String) -> Result<WorkspanPane, String> {
    let mut items = state.0.lock().map_err(|_| "workbench_state_poisoned")?;
    let index = items.iter().position(|pane| pane.pane_id == pane_id).ok_or("workbench_pane_not_found")?;
    for item in items.iter_mut() { item.focused = false; }
    items[index].focused = true;
    Ok(items[index].clone())
}

#[tauri::command]
pub fn workbench_remove_pane(state: State<'_, WorkbenchState>, pane_id: String) -> Result<(), String> {
    let mut items = state.0.lock().map_err(|_| "workbench_state_poisoned")?;
    items.retain(|pane| pane.pane_id != pane_id);
    Ok(())
}
