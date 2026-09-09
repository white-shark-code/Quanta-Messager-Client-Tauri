/**
 * Shared TypeScript types for the Tauri bridge layer.
 *
 * These types describe the contract between the frontend and the
 * Tauri Rust side (custom commands + plugin events). Keeping them in a
 * dedicated module avoids accidental circular dependencies between
 * {@link ./tauriBridge} and the rest of `src/infra`.
 */
export {};
