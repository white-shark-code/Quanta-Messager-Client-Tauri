//! Tauri command for logging frontend errors.
//!
//! Команда Tauri для логирования ошибок из фронтенда.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct FrontendLog {
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub context: Option<serde_json::Value>,
}

/// Filter sensitive fields from context (passwords, tokens, private keys).
///
/// Фильтрует чувствительные поля из контекста.
fn sanitize(value: &serde_json::Value) -> serde_json::Value {
    const SENSITIVE_KEYS: &[&str] = &[
        "password",
        "passphrase",
        "token",
        "accessToken",
        "privateKey",
        "privateKeyArmored",
        "encrypted_message",
        "signature",
    ];

    match value {
        serde_json::Value::Object(map) => {
            let mut sanitized = serde_json::Map::new();
            for (k, v) in map {
                if SENSITIVE_KEYS.contains(&k.as_str()) {
                    sanitized.insert(k.clone(), serde_json::Value::String("[REDACTED]".into()));
                } else {
                    sanitized.insert(k.clone(), sanitize(v));
                }
            }
            serde_json::Value::Object(sanitized)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(sanitize).collect())
        }
        other => other.clone(),
    }
}

/// Log a frontend error to the Rust-side logger (stderr / env_logger).
///
/// Логирует ошибку из фронтенда в логгер на стороне Rust.
#[tauri::command]
pub async fn log_frontend_error(log: FrontendLog) -> Result<(), String> {
    let sanitized_context = log.context.as_ref().map(sanitize);

    match log.level.as_str() {
        "error" => log::error!("[frontend] {} | context: {:?}", log.message, sanitized_context),
        "warn" => log::warn!("[frontend] {} | context: {:?}", log.message, sanitized_context),
        "info" => log::info!("[frontend] {} | context: {:?}", log.message, sanitized_context),
        "debug" => log::debug!("[frontend] {} | context: {:?}", log.message, sanitized_context),
        _ => log::info!(
            "[frontend:{}] {} | context: {:?}",
            log.level,
            log.message,
            sanitized_context
        ),
    }
    Ok(())
}
