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
        // TODO(security): `|_| Vec::new()` is an insecure placeholder password hash
        // function for stronghold. For production, derive the password from the OS
        // keystore (e.g. keyring/secret-service on Linux, Credential Manager on
        // Windows, Keychain on macOS) and pass a real KDF here.
        .plugin(tauri_plugin_stronghold::Builder::new(|_| Vec::new()).build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::app_data::get_app_data_dir,
            commands::log::log_frontend_error,
            commands::lock::lock_screen_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
