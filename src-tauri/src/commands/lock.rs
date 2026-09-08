//! Tauri command to trigger app lock screen.
//!
//! Команда Tauri для запроса блокировки экрана приложения.

use tauri::{AppHandle, Emitter};

/// Emit a `app://lock` event to the WebView.
/// The frontend (UnlockAgainModal / useUnlockModal) listens for this event.
///
/// Эмитирует событие `app://lock` в WebView.
#[tauri::command]
pub async fn lock_screen_now(app: AppHandle) -> Result<(), String> {
    app.emit("app://lock", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}
