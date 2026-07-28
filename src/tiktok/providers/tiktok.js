/**
 * Dispatcher scaffolding only — NOT a working TikTok integration.
 *
 * conversations.channel already accepts "tiktok" (see prisma/schema.prisma)
 * so the data model doesn't need another migration once real API access
 * exists; this file exists so the send/normalize dispatch shape is in
 * place, matching src/whatsapp/providers/*.js and
 * src/instagram/providers/meta.js exactly.
 *
 * Per this project's own rule (never guess an API surface from patterns),
 * the actual HTTP calls are intentionally NOT written here — TikTok's
 * business messaging API is newer, has limited/gated rollout, and its
 * request/response shapes aren't something to invent from Meta's Graph API
 * pattern. Write the real implementation only once you have verified
 * TikTok for Business API documentation and confirmed developer access.
 */

function sendTikTokMessage() {
  throw new Error(
    "TikTok is not yet implemented — pending verified TikTok Business API access. See src/tiktok/providers/tiktok.js."
  );
}

function normalizeTikTokPayload() {
  throw new Error(
    "TikTok is not yet implemented — pending verified TikTok Business API access. See src/tiktok/providers/tiktok.js."
  );
}

module.exports = { sendTikTokMessage, normalizeTikTokPayload };
