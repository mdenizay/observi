//! Monitor tags (free-form labels).

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::routing::get;
use rusqlite::Connection;
use serde_json::{Value, json};

use crate::api::{ApiResult, visible_for};
use crate::auth::AuthUser;
use crate::models::Invalid;
use crate::state::AppState;

pub const MAX_PER_MONITOR: usize = 20;
pub const MAX_LEN: usize = 30;

/// Trim, collapse whitespace, drop empties and case-insensitive duplicates.
pub fn normalize(tags: Vec<String>) -> Result<Vec<String>, Invalid> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for t in tags {
        let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
        if t.is_empty() {
            continue;
        }
        if t.chars().count() > MAX_LEN {
            return Err(Invalid("tag_too_long", "A tag can be at most 30 characters"));
        }
        if seen.insert(t.to_lowercase()) {
            out.push(t);
        }
    }
    if out.len() > MAX_PER_MONITOR {
        return Err(Invalid("too_many_tags", "A monitor can have at most 20 tags"));
    }
    Ok(out)
}

pub fn tags_map(c: &Connection) -> Result<HashMap<i64, Vec<String>>> {
    let mut st = c.prepare_cached(
        "SELECT mt.monitor_id, t.name FROM monitor_tags mt JOIN tags t ON t.id = mt.tag_id ORDER BY t.name COLLATE NOCASE",
    )?;
    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    for r in st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (id, name) = r?;
        map.entry(id).or_default().push(name);
    }
    Ok(map)
}

fn tag_id(c: &Connection, name: &str) -> Result<i64> {
    c.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", [name])?;
    Ok(c.query_row("SELECT id FROM tags WHERE name = ?", [name], |r| r.get(0))?)
}

pub fn set_monitor_tags(c: &Connection, monitor_id: i64, tags: &[String]) -> Result<()> {
    c.execute("DELETE FROM monitor_tags WHERE monitor_id = ?", [monitor_id])?;
    for t in tags {
        let id = tag_id(c, t)?;
        c.execute("INSERT OR IGNORE INTO monitor_tags (monitor_id, tag_id) VALUES (?, ?)", [monitor_id, id])?;
    }
    cleanup(c)
}

/// Add or remove one tag on many monitors; returns how many monitors exist among `ids`.
pub fn bulk(c: &Connection, ids: &[i64], tag: &str, add: bool) -> Result<usize> {
    let mut n = 0;
    let tid = if add { Some(tag_id(c, tag)?) } else { c.query_row("SELECT id FROM tags WHERE name = ?", [tag], |r| r.get(0)).ok() };
    for id in ids {
        if !c.query_row("SELECT EXISTS(SELECT 1 FROM monitors WHERE id = ?)", [id], |r| r.get::<_, bool>(0))? {
            continue;
        }
        n += 1;
        if let Some(tid) = tid {
            if add {
                c.execute("INSERT OR IGNORE INTO monitor_tags (monitor_id, tag_id) VALUES (?, ?)", [*id, tid])?;
            } else {
                c.execute("DELETE FROM monitor_tags WHERE monitor_id = ? AND tag_id = ?", [*id, tid])?;
            }
        }
    }
    cleanup(c)?;
    Ok(n)
}

/// Drop tags nothing uses any more.
fn cleanup(c: &Connection) -> Result<()> {
    c.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM monitor_tags)", [])?;
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new().route("/tags", get(list))
}

async fn list(State(st): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Json<Value>> {
    let visible = visible_for(&st, &user).await?;
    let items = st
        .db
        .call(move |c| {
            let map = tags_map(c)?;
            let mut counts: HashMap<String, i64> = HashMap::new();
            for (id, tags) in map {
                if visible.as_ref().is_some_and(|v| !v.contains(&id)) {
                    continue;
                }
                for t in tags {
                    *counts.entry(t).or_default() += 1;
                }
            }
            let mut v: Vec<_> = counts.into_iter().collect();
            v.sort_by_key(|a| a.0.to_lowercase());
            Ok(v)
        })
        .await?;
    Ok(Json(json!({ "items": items.into_iter().map(|(name, count)| json!({ "name": name, "count": count })).collect::<Vec<_>>() })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_dedupes() {
        let out = normalize(vec![" Client  A ".into(), "client a".into(), "".into(), "Laravel".into()]).unwrap();
        assert_eq!(out, vec!["Client A".to_string(), "Laravel".to_string()]);
        assert_eq!(normalize(vec!["x".repeat(31)]).unwrap_err().0, "tag_too_long");
        assert_eq!(normalize((0..21).map(|i| format!("t{i}")).collect()).unwrap_err().0, "too_many_tags");
    }
}
