use axum::extract::State;
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

use crate::brand;
use crate::state::AppState;

#[derive(Embed)]
#[folder = "web/dist"]
struct Assets;

/// Serves the embedded SPA; unknown paths fall back to index.html.
pub async fn static_handler(State(st): State<AppState>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if let Some(file) = Assets::get(path).filter(|_| !path.is_empty() && path != "index.html") {
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
    let Some(file) = Assets::get("index.html") else {
        return (StatusCode::NOT_FOUND, "frontend not built").into_response();
    };
    let brand = st.db.call(|c| brand::get(c)).await.unwrap_or(brand::Brand { name: brand::DEFAULT_NAME.into(), logo: None });
    let html = inject_brand(&String::from_utf8_lossy(&file.data), &brand);
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8".to_string()),
            (header::CACHE_CONTROL, "no-cache".to_string()),
        ],
        html,
    )
        .into_response()
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Replace the title and favicon and expose the brand to the app before it boots.
fn inject_brand(html: &str, brand: &brand::Brand) -> String {
    let mut out = html.to_string();
    if let (Some(a), Some(b)) = (out.find("<title>"), out.find("</title>")) {
        out.replace_range(a..b + "</title>".len(), &format!("<title>{}</title>", escape_html(&brand.name)));
    }
    if let Some(logo) = &brand.logo
        && let Some(pos) = out.find("rel=\"icon\"")
    {
        let start = out[..pos].rfind("<link").unwrap_or(pos);
        if let Some(end) = out[pos..].find('>') {
            out.replace_range(start..pos + end + 1, &format!("<link rel=\"icon\" href=\"{}\" />", escape_html(logo)));
        }
    }
    // `<` is escaped so a name can never close the script element.
    let json = serde_json::to_string(brand).unwrap_or_default().replace('<', "\\u003c");
    let script = format!("<script>window.__OBSERVI_BRAND__={json}</script>");
    match out.find("</head>") {
        Some(i) => out.insert_str(i, &script),
        None => out.push_str(&script),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injects_title_favicon_and_state_safely() {
        let html = "<head><link rel=\"icon\" type=\"image/svg+xml\" href=\"/favicon.svg\" /><title>Observi</title></head>";
        let b = brand::Brand { name: "A </script><b>".into(), logo: Some("/api/branding/logo?v=1".into()) };
        let out = inject_brand(html, &b);
        assert!(out.contains("<title>A &lt;/script&gt;&lt;b&gt;</title>"));
        assert!(out.contains("href=\"/api/branding/logo?v=1\""));
        assert!(!out.contains("favicon.svg"));
        assert!(out.matches("</script>").count() == 1, "name must not close the script tag");
    }
}
