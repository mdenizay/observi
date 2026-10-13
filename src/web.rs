use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "web/dist"]
struct Assets;

/// Serves the embedded SPA; unknown paths fall back to index.html.
pub async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if let Some(file) = Assets::get(path).filter(|_| !path.is_empty()) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        let cache = if path.starts_with("assets/") {
            "public, max-age=31536000, immutable"
        } else {
            "public, max-age=3600"
        };
        return (
            [(header::CONTENT_TYPE, mime.as_ref().to_string()), (header::CACHE_CONTROL, cache.to_string())],
            file.data,
        )
            .into_response();
    }
    // A missing hashed asset (e.g. a stale chunk after a redeploy) must 404,
    // otherwise the browser receives HTML for a script and the app goes blank.
    if path.starts_with("assets/") {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    match Assets::get("index.html") {
        Some(file) => (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8".to_string()),
                (header::CACHE_CONTROL, "no-cache".to_string()),
            ],
            file.data,
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "frontend not built").into_response(),
    }
}
