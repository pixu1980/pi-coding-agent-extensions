/**
 * pi-remote - public barrel (lib)
 *
 * Exposes the extension entry only; pairing/push modules stay importable
 * but are internal.
 */

import extension from './_extension.ts';

export default extension;
export { buildPairUrl, clampPairTtlMs, QRSession, roomIdFor, TOKEN_TTL_MS } from './_pairing.ts';
export {
  generateVapidKeys,
  buildWakeUpPayload,
  loadOrCreateVapidKeys,
  setSubscription,
  removeSubscription,
  loadSubscriptions,
  pushToSubscribers,
} from './_push.ts';
export { ChatSession, stringifyContent, stringifyToolResult } from './_chat.ts';
export { createAskBridge, PI_ASK_STARTED, PI_ASK_COMPLETED, PI_ASK_SUBMIT, PI_ASK_SUBMIT_RESULT } from './_ask.ts';
export { loadOrCreateIdentity, ed25519Sign, ed25519Verify, piRemoteDir } from './_identity.ts';
export { addPeer, findPeer, loadPeers, removePeer } from './_peers.ts';
export { RelayClient, RoomAlreadyOpenError } from './_relay.ts';
export { appendAudit, readAudit, shortPeer, auditPath } from './_audit.ts';
export {
  encryptPushMessage,
  deriveContentKeys,
  sendPush,
  signVapidJwt,
  verifyVapidJwt,
  derToRawEs256,
  b64urlEncode,
  b64urlDecode,
  parseSubscription,
} from './_webpush.ts';
