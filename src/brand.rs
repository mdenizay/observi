//! White-label branding: product name and optional logo.

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::db::now_ms;
use crate::models::{Invalid, get_setting, set_setting};

pub const DEFAULT_NAME: &str = "Observi";
pub const MAX_NAME_CHARS: usize = 40;
pub const MAX_LOGO_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct Brand {
    pub name: String,
    /// URL of the uploaded logo (with a cache-busting version), if any.
    pub logo: Option<String>,
}

pub fn get(c: &Connection) -> Result<Brand> {
    let name = get_setting(c, "brand_name")?.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| DEFAULT_NAME.into());
    let version: Option<i64> = c
        .query_row("SELECT updated_at FROM branding_logo WHERE id = 1", [], |r| r.get(0))
        .optional()?;
    Ok(Brand { name, logo: version.map(|v| format!("/api/branding/logo?v={v}")) })
}

pub fn set_name(c: &Connection, name: &str) -> Result<(), Invalid> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Invalid("name_required", "Name is required"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(Invalid("name_too_long", "Name is too long (max 40 characters)"));
    }
    set_setting(c, "brand_name", name).map_err(|_| Invalid("internal", "Could not save"))
}

/// Validate the declared type against the file's magic bytes.
pub fn sniff(content_type: &str, data: &[u8]) -> Option<&'static str> {
    let ct = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    match ct.as_str() {
        "image/png" if data.starts_with(b"\x89PNG\r\n\x1a\n") => Some("image/png"),
        "image/jpeg" if data.starts_with(&[0xFF, 0xD8, 0xFF]) => Some("image/jpeg"),
        "image/gif" if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") => Some("image/gif"),
        "image/webp" if data.len() > 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" => Some("image/webp"),
        "image/svg+xml" => {
            let head = String::from_utf8_lossy(&data[..data.len().min(512)]).to_ascii_lowercase();
            let head = head.trim_start_matches('\u{feff}').trim_start();
            (head.starts_with("<svg") || head.starts_with("<?xml") || head.starts_with("<!--") || head.starts_with("<!doctype svg"))
                .then_some("image/svg+xml")
        }
        _ => None,
    }
}

pub fn set_logo(c: &Connection, mime: &str, data: &[u8]) -> Result<()> {
    c.execute(
        "INSERT INTO branding_logo (id, mime, data, updated_at) VALUES (1, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at",
        rusqlite::params![mime, data, now_ms()],
    )?;
    Ok(())
}

pub fn clear_logo(c: &Connection) -> Result<()> {
    c.execute("DELETE FROM branding_logo WHERE id = 1", [])?;
    Ok(())
}

pub fn logo(c: &Connection) -> Result<Option<(String, Vec<u8>)>> {
    Ok(c.query_row("SELECT mime, data FROM branding_logo WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniff_checks_magic_bytes() {
        assert_eq!(sniff("image/png", b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(sniff("image/png", b"GIF89a"), None, "declared type must match content");
        assert_eq!(sniff("image/svg+xml; charset=utf-8", b"<svg xmlns=\"x\"/>"), Some("image/svg+xml"));
        assert_eq!(sniff("image/svg+xml", b"<html>"), None);
        assert_eq!(sniff("text/html", b"<svg/>"), None);
    }
}
