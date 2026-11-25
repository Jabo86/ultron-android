// Private calls require an actual TURN allocation. STUN cannot satisfy
// iceTransportPolicy: "relay" and would leave both phones on "Connecting…".
export function turnIceConfig(reply) {
  const urls = (Array.isArray(reply?.urls) ? reply.urls : [reply?.urls])
    .filter(value => typeof value === "string" && /^turns?:[^\s]+$/i.test(value));
  if (!urls.length || typeof reply?.username !== "string" || !reply.username ||
      typeof reply?.credential !== "string" || !reply.credential) {
    throw new Error("Il gateway non ha fornito un relay TURN valido per la chiamata.");
  }
  return {
    iceTransportPolicy: "relay",
    bundlePolicy: "max-bundle",
    iceServers: [{ urls, username: reply.username, credential: reply.credential }],
  };
}
