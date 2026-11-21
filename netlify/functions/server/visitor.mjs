import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { AIError, digest, equal, keys } from "./core.mjs";

// Only Netlify's trusted Function context supplies the address. Never trust request headers.
export function visitorId(context, env, now) {
  const ip = context?.ip;
  if (!isIP(ip ?? ""))
    throw new AIError(
      503,
      "visitor_identity",
      "Visitor protection is unavailable. Local search still works.",
    );
  let network = ip;
  if (isIP(ip) === 6) {
    const canonical = new URL(`https://[${ip}]/`).hostname.slice(1, -1);
    const [left, right = ""] = canonical.split("::");
    const a = left ? left.split(":") : [],
      b = right ? right.split(":") : [];
    const groups = [
      ...a,
      ...Array(8 - a.length - b.length).fill("0"),
      ...b,
    ].map((v) => parseInt(v, 16));
    network =
      groups.slice(0, 5).every((v) => v === 0) && groups[5] === 65535
        ? [
            groups[6] >> 8,
            groups[6] & 255,
            groups[7] >> 8,
            groups[7] & 255,
          ].join(".")
        : groups
            .slice(0, 4)
            .map((v) => v.toString(16))
            .join(":") + "::/64";
  }
  const day = new Date(now).toISOString().slice(0, 10);
  return createHmac("sha256", env.PADHAI_AI_SESSION_SECRET)
    .update(`visitor:${day}:${network}`)
    .digest("hex");
}
const sign = (value, env) =>
  createHmac("sha256", env.PADHAI_AI_SESSION_SECRET)
    .update(`challenge:${value}`)
    .digest("base64url");
export function createChallenge(owner, origin, env, now) {
  const value = Buffer.from(
    JSON.stringify({
      owner,
      origin,
      expires: now + 180000,
      nonce: randomBytes(24).toString("base64url"),
    }),
  ).toString("base64url");
  return { challenge: `${value}.${sign(value, env)}`, bits: 16 };
}
export function verifyChallenge(body, owner, origin, env, now) {
  keys(body, ["challenge", "solution"]);
  if (
    typeof body.challenge !== "string" ||
    body.challenge.length > 1500 ||
    typeof body.solution !== "string" ||
    !/^[a-f0-9]{1,10}$/.test(body.solution)
  )
    throw new AIError(400, "challenge", "The browser check was invalid.");
  const [value, signature, extra] = body.challenge.split(".");
  if (extra || !equal(signature, sign(value, env)))
    throw new AIError(403, "challenge", "The browser check was invalid.");
  let data;
  try {
    data = JSON.parse(Buffer.from(value, "base64url").toString());
  } catch {
    throw new AIError(403, "challenge", "The browser check was invalid.");
  }
  if (
    data.owner !== owner ||
    data.origin !== origin ||
    !Number.isFinite(data.expires) ||
    data.expires <= now ||
    data.expires > now + 180000 ||
    !digest(`${body.challenge}:${body.solution}`).startsWith("0000")
  )
    throw new AIError(
      403,
      "challenge",
      "The browser check expired or failed. Retry the AI connection.",
    );
  return { id: digest(body.challenge), expires: data.expires };
}
