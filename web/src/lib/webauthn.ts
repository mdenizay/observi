import { translate } from '@/i18n'
import { errorMessage } from '@/lib/api'

/** Minimal WebAuthn helpers: base64url codecs and (de)serialisation for the server's JSON options. */

export const supportsPasskeys = () =>
  typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials

export function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uDecode(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

interface CredDesc {
  id: string
  type: 'public-key'
  transports?: AuthenticatorTransport[]
}
/** `publicKey` as the server sends it: binary fields are base64url strings. */
export type PublicKeyJSON = {
  challenge: string
  user?: { id: string; name: string; displayName: string }
  excludeCredentials?: CredDesc[]
  allowCredentials?: CredDesc[]
} & Record<string, unknown>

const decodeDescs = (list?: CredDesc[]) => list?.map((c) => ({ ...c, id: b64uDecode(c.id) }))

export function creationOptions(pk: PublicKeyJSON): PublicKeyCredentialCreationOptions {
  return {
    ...pk,
    challenge: b64uDecode(pk.challenge),
    user: pk.user && { ...pk.user, id: b64uDecode(pk.user.id) },
    excludeCredentials: decodeDescs(pk.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions
}

export function requestOptions(pk: PublicKeyJSON): PublicKeyCredentialRequestOptions {
  return {
    ...pk,
    challenge: b64uDecode(pk.challenge),
    allowCredentials: decodeDescs(pk.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions
}

export async function createCredential(pk: PublicKeyJSON) {
  const cred = (await navigator.credentials.create({ publicKey: creationOptions(pk) })) as PublicKeyCredential | null
  if (!cred) throw new DOMException('No credential', 'NotAllowedError')
  const r = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    response: { clientDataJSON: b64uEncode(r.clientDataJSON), attestationObject: b64uEncode(r.attestationObject) },
  }
}

export async function getCredential(pk: PublicKeyJSON) {
  const cred = (await navigator.credentials.get({ publicKey: requestOptions(pk) })) as PublicKeyCredential | null
  if (!cred) throw new DOMException('No credential', 'NotAllowedError')
  const r = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    response: {
      clientDataJSON: b64uEncode(r.clientDataJSON),
      authenticatorData: b64uEncode(r.authenticatorData),
      signature: b64uEncode(r.signature),
      userHandle: r.userHandle ? b64uEncode(r.userHandle) : null,
    },
  }
}

/** True when the user dismissed or timed out the browser's passkey prompt. */
export const isPasskeyCancel = (e: unknown) => e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')

/** User-facing message for a failed passkey ceremony (browser DOMExceptions and API errors). */
export function passkeyErrorMessage(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'InvalidStateError') return translate('errors.passkey_exists')
    if (e.name === 'SecurityError' || e.name === 'NotSupportedError') return translate('errors.passkey_unsupported')
  }
  return errorMessage(e)
}
