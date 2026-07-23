use serde::Serialize;

#[derive(Serialize)]
struct HealthStatus {
    app: &'static str,
    version: &'static str,
    platform: &'static str,
}

#[tauri::command]
fn app_health() -> HealthStatus {
    HealthStatus {
        app: "CTFBox",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_health])
        .run(tauri::generate_context!())
        .expect("CTFBox 启动失败");
}
