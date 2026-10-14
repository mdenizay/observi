//! Just enough WebAuthn for passkeys: registration without attestation and
//! ES256 (P-256) assertions with user verification. Everything is pure Rust, so
//! the binary stays fully static.
#![allow(dead_code)] // wired up with the security endpoints in the next step

use anyhow::{Context, Result, bail};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn b64_encode(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}

pub fn b64_decode(s: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).context("invalid base64url")
}

pub const FLAG_UP: u8 = 0x01;
pub const FLAG_UV: u8 = 0x04;
pub const FLAG_AT: u8 = 0x40;

// ---------- minimal CBOR (RFC 8949): ints, byte/text strings, arrays, maps ----------

#[derive(Debug, Clone, PartialEq)]
pub enum Cbor {
    Int(i64),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<Cbor>),
    Map(Vec<(Cbor, Cbor)>),
    Other,
}

impl Cbor {
    fn get(&self, key: &Cbor) -> Option<&Cbor> {
        match self {
            Cbor::Map(m) => m.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn text_key(&self, key: &str) -> Option<&Cbor> {
        self.get(&Cbor::Text(key.to_string()))
    }
}

/// Decode one item; returns it with the number of bytes consumed.
pub fn cbor_decode(data: &[u8]) -> Result<(Cbor, usize)> {
    decode_at(data, 0, 0)
}

fn decode_at(data: &[u8], pos: usize, depth: usize) -> Result<(Cbor, usize)> {
    if depth > 8 {
        bail!("CBOR nested too deeply");
    }
    let first = *data.get(pos).context("truncated CBOR")?;
    let (major, info) = (first >> 5, first & 0x1f);
    let mut p = pos + 1;
    let arg: u64 = match info {
        0..=23 => info as u64,
        24..=27 => {
            let n = 1usize << (info - 24);
            let bytes = data.get(p..p + n).context("truncated CBOR")?;
            p += n;
            bytes.iter().fold(0u64, |a, b| (a << 8) | *b as u64)
        }
        _ => bail!("unsupported CBOR encoding"),
    };
    let take = |p: usize, n: u64| -> Result<&[u8]> {
        let n = usize::try_from(n).ok().filter(|n| *n <= 1 << 20).context("CBOR item too large")?;
        data.get(p..p + n).context("truncated CBOR")
    };
    match major {
        0 => Ok((Cbor::Int(i64::try_from(arg).context("CBOR integer too large")?), p - pos)),
        1 => Ok((Cbor::Int(-1 - i64::try_from(arg).context("CBOR integer too large")?), p - pos)),
        2 => {
            let b = take(p, arg)?.to_vec();
            Ok((Cbor::Bytes(b), p + arg as usize - pos))
        }
        3 => {
            let s = String::from_utf8(take(p, arg)?.to_vec()).context("invalid UTF-8 in CBOR")?;
            Ok((Cbor::Text(s), p + arg as usize - pos))
        }
        4 | 5 => {
            if arg > 256 {
                bail!("CBOR collection too large");
            }
            let (mut items, mut q) = (Vec::new(), p);
            for _ in 0..(if major == 5 { arg * 2 } else { arg }) {
                let (item, used) = decode_at(data, q, depth + 1)?;
                items.push(item);
                q += used;
            }
            let value = if major == 4 {
                Cbor::Array(items)
            } else {
                let mut it = items.into_iter();
                let mut map = Vec::new();
                while let (Some(k), Some(v)) = (it.next(), it.next()) {
                    map.push((k, v));
                }
                Cbor::Map(map)
            };
            Ok((value, q - pos))
        }
        6 => {
            let (inner, used) = decode_at(data, p, depth + 1)?;
            Ok((inner, p + used - pos))
        }
        _ => Ok((Cbor::Other, p - pos)),
    }
}

// ---------- authenticator data ----------

pub struct AuthData<'a> {
    pub rp_id_hash: &'a [u8],
    pub flags: u8,
    pub sign_count: u32,
    /// Everything after the 37-byte header (attested credential data, extensions).
    pub rest: &'a [u8],
}

pub fn parse_auth_data(data: &[u8]) -> Result<AuthData<'_>> {
    if data.len() < 37 {
        bail!("authenticator data too short");
    }
    Ok(AuthData {
        rp_id_hash: &data[..32],
        flags: data[32],
        sign_count: u32::from_be_bytes([data[33], data[34], data[35], data[36]]),
        rest: &data[37..],
    })
}

pub struct Credential {
    pub id: Vec<u8>,
    /// SEC1 uncompressed point: 0x04 || x || y.
    pub public_key: Vec<u8>,
    pub sign_count: u32,
}

/// Registration: take the credential out of an attestation object (the
/// attestation statement itself is not verified, we ask for "none").
pub fn parse_attestation(att_obj: &[u8], rp_id: &str) -> Result<Credential> {
    let (obj, _) = cbor_decode(att_obj)?;
    let Some(Cbor::Bytes(auth_data)) = obj.text_key("authData") else { bail!("missing authData") };
    let ad = parse_auth_data(auth_data)?;
    if ad.rp_id_hash != Sha256::digest(rp_id.as_bytes()).as_slice() {
        bail!("the passkey was created for a different site");
    }
    if ad.flags & FLAG_UP == 0 {
        bail!("user presence is required");
    }
    if ad.flags & FLAG_AT == 0 {
        bail!("no credential data");
    }
    // aaguid (16) | credentialIdLength (2) | credentialId | COSE public key
    let r = ad.rest;
    if r.len() < 18 {
        bail!("credential data too short");
    }
    let id_len = u16::from_be_bytes([r[16], r[17]]) as usize;
    let id = r.get(18..18 + id_len).context("credential id truncated")?.to_vec();
    let (cose, _) = cbor_decode(&r[18 + id_len..])?;
    let int = |k: i64| cose.get(&Cbor::Int(k));
    let (Some(Cbor::Int(2)), Some(Cbor::Int(-7)), Some(Cbor::Int(1))) = (int(1), int(3), int(-1)) else {
        bail!("unsupported key type: only ES256 (P-256) passkeys are supported");
    };
    let (Some(Cbor::Bytes(x)), Some(Cbor::Bytes(y))) = (int(-2), int(-3)) else { bail!("invalid public key") };
    if x.len() != 32 || y.len() != 32 {
        bail!("invalid public key");
    }
    let mut public_key = vec![0x04];
    public_key.extend_from_slice(x);
    public_key.extend_from_slice(y);
    VerifyingKey::from_sec1_bytes(&public_key).context("the public key is not a valid P-256 point")?;
    Ok(Credential { id, public_key, sign_count: ad.sign_count })
}

/// The browser-provided clientDataJSON must carry our challenge, the right
/// ceremony type and this site's origin.
pub fn check_client_data(json: &[u8], expected_type: &str, challenge: &[u8], origin: &str) -> Result<()> {
    let v: Value = serde_json::from_slice(json).context("invalid clientDataJSON")?;
    if v["type"] != expected_type {
        bail!("wrong ceremony type");
    }
    if v["challenge"].as_str().map(b64_decode).transpose()?.as_deref() != Some(challenge) {
        bail!("challenge mismatch");
    }
    if v["origin"].as_str() != Some(origin) {
        bail!("origin mismatch");
    }
    Ok(())
}

pub struct Assertion {
    pub sign_count: u32,
}

/// Verify a login assertion: relying-party hash, user presence + verification
/// flags and the ES256 signature over `authenticatorData || SHA-256(clientDataJSON)`.
pub fn verify_assertion(public_key: &[u8], rp_id: &str, auth_data: &[u8], client_data_json: &[u8], signature_der: &[u8]) -> Result<Assertion> {
    let ad = parse_auth_data(auth_data)?;
    if ad.rp_id_hash != Sha256::digest(rp_id.as_bytes()).as_slice() {
        bail!("the passkey belongs to a different site");
    }
    if ad.flags & FLAG_UP == 0 {
        bail!("user presence is required");
    }
    if ad.flags & FLAG_UV == 0 {
        bail!("user verification is required");
    }
    let mut signed = auth_data.to_vec();
    signed.extend_from_slice(&Sha256::digest(client_data_json));
    let key = VerifyingKey::from_sec1_bytes(public_key).context("stored key is invalid")?;
    let sig = Signature::from_der(signature_der).context("invalid signature encoding")?;
    key.verify(&signed, &sig).map_err(|_| anyhow::anyhow!("signature verification failed"))?;
    Ok(Assertion { sign_count: ad.sign_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::SigningKey;
    use p256::ecdsa::signature::Signer;

    fn cbor_bytes(b: &[u8]) -> Vec<u8> {
        let mut v = if b.len() < 24 { vec![0x40 | b.len() as u8] } else { vec![0x58, b.len() as u8] };
        v.extend_from_slice(b);
        v
    }
    fn cbor_text(s: &str) -> Vec<u8> {
        let mut v = vec![0x60 | s.len() as u8];
        v.extend_from_slice(s.as_bytes());
        v
    }

    fn key() -> (SigningKey, Vec<u8>) {
        let sk = SigningKey::from_slice(&[7u8; 32]).unwrap();
        let pk = sk.verifying_key().to_sec1_point(false).as_bytes().to_vec();
        (sk, pk)
    }

    fn attestation(rp: &str, flags: u8, pk: &[u8]) -> Vec<u8> {
        let mut cose = vec![0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21];
        cose.extend(cbor_bytes(&pk[1..33]));
        cose.push(0x22);
        cose.extend(cbor_bytes(&pk[33..65]));
        let mut ad = Sha256::digest(rp.as_bytes()).to_vec();
        ad.push(flags);
        ad.extend_from_slice(&5u32.to_be_bytes());
        ad.extend_from_slice(&[0u8; 16]);
        ad.extend_from_slice(&4u16.to_be_bytes());
        ad.extend_from_slice(&[1, 2, 3, 4]);
        ad.extend(cose);
        let mut obj = vec![0xa3];
        obj.extend(cbor_text("fmt"));
        obj.extend(cbor_text("none"));
        obj.extend(cbor_text("attStmt"));
        obj.push(0xa0);
        obj.extend(cbor_text("authData"));
        obj.extend(cbor_bytes(&ad));
        obj
    }

    #[test]
    fn cbor_decoding() {
        let (v, used) = cbor_decode(&[0xa2, 0x01, 0x02, 0x26, 0x41, 0xff]).unwrap();
        assert_eq!(used, 6);
        assert_eq!(v.get(&Cbor::Int(1)), Some(&Cbor::Int(2)));
        assert_eq!(v.get(&Cbor::Int(-7)), Some(&Cbor::Bytes(vec![0xff])));
        assert!(cbor_decode(&[0x58, 0x05, 1, 2]).is_err(), "truncated byte string");
        assert!(cbor_decode(&[0xf6]).is_ok(), "null and other simple values are tolerated");
        assert!(cbor_decode(&[0xff]).is_err(), "indefinite-length / break codes are rejected");
    }

    #[test]
    fn registration_extracts_the_credential() {
        let (_, pk) = key();
        let cred = parse_attestation(&attestation("example.com", FLAG_UP | FLAG_AT | FLAG_UV, &pk), "example.com").unwrap();
        assert_eq!(cred.id, vec![1, 2, 3, 4]);
        assert_eq!(cred.public_key, pk);
        assert_eq!(cred.sign_count, 5);
        assert!(parse_attestation(&attestation("example.com", FLAG_UP | FLAG_AT, &pk), "evil.com").is_err(), "wrong rp id");
        assert!(parse_attestation(&attestation("example.com", FLAG_AT, &pk), "example.com").is_err(), "no user presence");
        assert!(parse_attestation(&attestation("example.com", FLAG_UP, &pk), "example.com").is_err(), "no credential data");
    }

    #[test]
    fn client_data_checks() {
        let cd = format!(r#"{{"type":"webauthn.get","challenge":"{}","origin":"https://x.example"}}"#, b64_encode(b"chal"));
        assert!(check_client_data(cd.as_bytes(), "webauthn.get", b"chal", "https://x.example").is_ok());
        assert!(check_client_data(cd.as_bytes(), "webauthn.create", b"chal", "https://x.example").is_err());
        assert!(check_client_data(cd.as_bytes(), "webauthn.get", b"other", "https://x.example").is_err());
        assert!(check_client_data(cd.as_bytes(), "webauthn.get", b"chal", "https://evil.example").is_err());
    }

    #[test]
    fn assertion_verification() {
        let (sk, pk) = key();
        let client_data = br#"{"type":"webauthn.get"}"#.to_vec();
        let mut auth_data = Sha256::digest(b"example.com").to_vec();
        auth_data.push(FLAG_UP | FLAG_UV);
        auth_data.extend_from_slice(&9u32.to_be_bytes());
        let mut signed = auth_data.clone();
        signed.extend_from_slice(&Sha256::digest(&client_data));
        let sig: Signature = sk.sign(&signed);
        let der = sig.to_der();
        let ok = verify_assertion(&pk, "example.com", &auth_data, &client_data, der.as_bytes()).unwrap();
        assert_eq!(ok.sign_count, 9);
        assert!(verify_assertion(&pk, "evil.com", &auth_data, &client_data, der.as_bytes()).is_err(), "wrong rp id");
        assert!(verify_assertion(&pk, "example.com", &auth_data, b"{}", der.as_bytes()).is_err(), "tampered client data");
        let mut no_uv = auth_data.clone();
        no_uv[32] = FLAG_UP;
        assert!(verify_assertion(&pk, "example.com", &no_uv, &client_data, der.as_bytes()).is_err(), "missing UV flag");
        let other = SigningKey::from_slice(&[9u8; 32]).unwrap();
        let bad: Signature = other.sign(&signed);
        assert!(verify_assertion(&pk, "example.com", &auth_data, &client_data, bad.to_der().as_bytes()).is_err(), "wrong key");
    }
}
