//! Language of server-generated text that leaves the system (notifications).
//! The web UI translates itself; API errors carry stable codes instead.

use std::sync::OnceLock;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    Tr,
}

static LANG: OnceLock<Lang> = OnceLock::new();

/// `OBSERVI_LANG`: "en" (default) or "tr".
pub fn init(value: &str) {
    let lang = if value.trim().to_lowercase().starts_with("tr") { Lang::Tr } else { Lang::En };
    let _ = LANG.set(lang);
}

pub fn lang() -> Lang {
    LANG.get().copied().unwrap_or(Lang::En)
}

/// Pick the string for the configured language.
pub fn pick<'a>(en: &'a str, tr: &'a str) -> &'a str {
    match lang() {
        Lang::En => en,
        Lang::Tr => tr,
    }
}
