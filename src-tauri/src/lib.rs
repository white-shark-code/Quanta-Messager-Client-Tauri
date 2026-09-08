mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or(if cfg!(debug_assertions) {
            "debug"
        } else {
            "info"
        }),
    )
    .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_stronghold::init())
        .plugin(tauri_plugin_store::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_data::get_app_data_dir,
            commands::log::log_frontend_error,
            commands::lock::lock_screen_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
