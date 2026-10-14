//! Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s) and the
//! small helpers around them: base32, QR codes and recovery codes.
#![allow(dead_code)] // wired up with the security endpoints in the next step

use anyhow::{Result, anyhow};
use hmac::{Hmac, KeyInit, Mac};
use sha1::Sha1;
use sha2::{Digest, Sha256};

const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECS: u64 = 30;

pub fn base32_encode(data: &[u8]) -> String {
    let mut out = String::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for &b in data {
        buf = (buf << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            out.push(ALPHABET[((buf >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buf << (5 - bits)) & 31) as usize] as char);
    }
    out
}

pub fn base32_decode(s: &str) -> Option<Vec<u8>> {
    let (mut buf, mut bits) = (0u32, 0u32);
    let mut out = Vec::new();
    for c in s.chars().filter(|c| !c.is_whitespace() && *c != '=') {
        let v = ALPHABET.iter().position(|a| *a as char == c.to_ascii_uppercase())? as u32;
        buf = (buf << 5) | v;
        bits += 5;
        if bits >= 8 {
            out.push((buf >> (bits - 8)) as u8);
            bits -= 8;
        }
    }
    Some(out)
}

/// A fresh 160-bit secret, base32 encoded.
pub fn new_secret() -> String {
    let mut bytes = [0u8; 20];
    rand::fill(&mut bytes[..]);
    base32_encode(&bytes)
}

fn hotp(secret: &[u8], counter: u64) -> u32 {
    let mut mac = <Hmac<Sha1> as KeyInit>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[19] & 0x0f) as usize;
    let code = u32::from_be_bytes([digest[offset] & 0x7f, digest[offset + 1], digest[offset + 2], digest[offset + 3]]);
    code % 1_000_000
}

/// Check a 6-digit code against the secret, allowing one step of clock drift.
/// Returns the matched step so the caller can refuse replays (`step > last_step`).
pub fn verify(secret_b32: &str, code: &str, now_secs: u64, last_step: i64) -> Option<i64> {
    let digits: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let want: u32 = digits.parse().ok()?;
    let secret = base32_decode(secret_b32)?;
    let current = (now_secs / STEP_SECS) as i64;
    [current - 1, current, current + 1]
        .into_iter()
        .find(|step| *step > last_step && *step >= 0 && hotp(&secret, *step as u64) == want)
}

pub fn otpauth_url(issuer: &str, account: &str, secret: &str) -> String {
    let enc = |s: &str| {
        s.bytes()
            .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
            .collect::<String>()
    };
    format!("otpauth://totp/{}:{}?secret={secret}&issuer={}&algorithm=SHA1&digits=6&period=30", enc(issuer), enc(account), enc(issuer))
}

pub fn qr_svg(data: &str) -> Result<String> {
    let code = qrcode::QrCode::new(data.as_bytes()).map_err(|e| anyhow!("qr: {e}"))?;
    Ok(code.render::<qrcode::render::svg::Color>().min_dimensions(220, 220).quiet_zone(true).build())
}

/// Ten single-use recovery codes like `k7q2m-x9d4t`.
pub fn recovery_codes() -> Vec<String> {
    (0..10)
        .map(|_| {
            let mut b = [0u8; 7];
            rand::fill(&mut b[..]);
            let s = base32_encode(&b).to_lowercase();
            format!("{}-{}", &s[..5], &s[5..10])
        })
        .collect()
}

/// Recovery codes are matched ignoring case, spaces and dashes.
pub fn recovery_hash(code: &str) -> String {
    let normalized: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
    hex::encode(Sha256::digest(normalized.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc4226_test_vectors() {
        // RFC 4226 appendix D, secret "12345678901234567890".
        let secret = b"12345678901234567890";
        let want = [755224, 287082, 359152, 969429, 338314, 254676, 287922, 162583, 399871, 520489];
        for (counter, code) in want.iter().enumerate() {
            assert_eq!(hotp(secret, counter as u64), *code);
        }
    }

    #[test]
    fn verifies_with_drift_and_blocks_replays() {
        let secret = base32_encode(b"12345678901234567890");
        // T = 59 s → step 1 → 287082 (RFC 6238 vector truncated to 6 digits).
        assert_eq!(verify(&secret, "287082", 59, 0), Some(1));
        assert_eq!(verify(&secret, "287082", 59, 1), None, "the same step cannot be used twice");
        assert_eq!(verify(&secret, "287082", 59 + 30, 0), Some(1), "one step of drift is accepted");
        assert_eq!(verify(&secret, "287082", 59 + 90, 0), None);
        assert_eq!(verify(&secret, "28708", 59, 0), None);
        assert_eq!(verify(&secret, "abcdef", 59, 0), None);
        assert_eq!(verify(&secret, "287 082", 59, 0), Some(1), "spaces are ignored");
    }

    #[test]
    fn base32_roundtrip() {
        assert_eq!(base32_encode(b"foobar"), "MZXW6YTBOI");
        assert_eq!(base32_decode("mzxw6ytboi").unwrap(), b"foobar");
        let s = new_secret();
        assert_eq!(s.len(), 32);
        assert_eq!(base32_decode(&s).unwrap().len(), 20);
    }

    #[test]
    fn recovery_codes_are_distinct_and_normalised() {
        let codes = recovery_codes();
        assert_eq!(codes.len(), 10);
        assert!(codes.iter().all(|c| c.len() == 11 && c.as_bytes()[5] == b'-'));
        assert_eq!(recovery_hash(&codes[0]), recovery_hash(&codes[0].to_uppercase().replace('-', " ")));
        assert_ne!(recovery_hash(&codes[0]), recovery_hash(&codes[1]));
    }

    #[test]
    fn otpauth_and_qr() {
        let url = otpauth_url("My App", "a@b", "ABCDEF");
        assert_eq!(url, "otpauth://totp/My%20App:a%40b?secret=ABCDEF&issuer=My%20App&algorithm=SHA1&digits=6&period=30");
        assert!(qr_svg(&url).unwrap().starts_with("<?xml") || qr_svg(&url).unwrap().contains("<svg"));
    }
}
