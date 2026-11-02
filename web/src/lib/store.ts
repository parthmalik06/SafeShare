import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* ------------------------------------------------------------------ types */
export const CATEGORIES = ["Generator", "Water pump", "First-aid kit", "Oxygen cylinder", "Boat", "Tent", "Other"];
export const ALERT_KINDS = ["Water", "Medical", "Power", "Shelter", "Rescue", "Other"];
export const ADMIN = (process.env.ADMIN_NAME || "admin").toLowerCase();
export const START_CREDITS = 100;
const QR_TTL = 10 * 60 * 1000;

export type Status = "pending" | "verified" | "blacklisted";
export type User = { address: string; createdAt: number; role: "admin" | "member"; status: Status; credits: number; pass?: string };
export type Item = { id: string; title: string; category: string; description: string; condition: number; deposit: number; owner: string; createdAt: number; hasPhoto: boolean };
export type LoanStatus = "requested" | "approved" | "out" | "returned" | "rejected" | "disputed" | "resolved";
export type Loan = {
  id: string; itemId: string; borrower: string; owner: string; hours: number; status: LoanStatus; createdAt: number;
  approvedAt?: number; outAt?: number; dueAt?: number; returnedAt?: number;
  condOut?: number; condIn?: number; care?: number; kept?: number; refunded?: number; late?: boolean; damaged?: boolean;
  disputeReason?: string; disputeBy?: string; refundPct?: number;
};
export type Alert = { id: string; user: string; kind: string; message: string; ts: number; open: boolean };
export type Block = { index: number; ts: number; type: string; actor: string; detail: string; itemId?: string; loanId?: string; fingerprint?: string; prev: string; hash: string };
export type SecEvent = { ts: number; type: string; actor: string; detail: string };
type DB = { secret: string; paused: boolean; users: Record<string, User>; items: Record<string, Item>; loans: Record<string, Loan>; alerts: Alert[]; ledger: Block[]; security: SecEvent[]; sessions: Record<string, { name: string; ts: number }> };
export type Presence = { user: string; deviceId: string; label: string; page: string; seen: number };

export class Err extends Error {
  status: number;
  constructor(m: string, status = 400) { super(m); this.status = status; }
}

/* ---------------------------------------------------------------- storage */
const DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DIR, "db.json");
fs.mkdirSync(path.join(DIR, "photos"), { recursive: true });

const g = globalThis as unknown as { __ssdb?: DB; __presence?: Map<string, Presence>; __tries?: Map<string, { n: number; until: number }> };
const fresh = (): DB => ({ secret: crypto.randomBytes(32).toString("hex"), paused: false, users: {}, items: {}, loans: {}, alerts: [], ledger: [], security: [], sessions: {} });
function load(): DB {
  if (g.__ssdb) return g.__ssdb;
  let d: DB;
  try { const p = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); d = p && p.items && p.secret ? p : fresh(); } catch { d = fresh(); }
  d.sessions ??= {};
  g.__ssdb = d; return d;
}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(load()));
export const presence = () => (g.__presence ??= new Map());
export const photoPath = (id: string) => path.join(DIR, "photos", id);
export const readPhoto = (id: string) => { try { return fs.readFileSync(photoPath(id)); } catch { return null; } };

export const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
export const addressOf = (name: string) => "0x" + sha("user:" + name).slice(0, 40);
export const cleanName = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
const ZERO = "0".repeat(64);

/* ----------------------------------------------------------------- ledger */
function append(type: string, actor: string, detail: string, extra: Partial<Pick<Block, "itemId" | "loanId" | "fingerprint">> = {}) {
  const d = load();
  const b: Block = { index: d.ledger.length, ts: Date.now(), type, actor, detail, ...extra, prev: d.ledger.at(-1)?.hash ?? ZERO, hash: "" };
  b.hash = sha(JSON.stringify({ ...b, hash: undefined }));
  d.ledger.push(b);
}
export function chainValid() {
  const d = load();
  return d.ledger.every((b, i) => b.prev === (i ? d.ledger[i - 1].hash : ZERO) && b.hash === sha(JSON.stringify({ ...b, hash: undefined })));
}
function sec(type: string, actor: string, detail: string) {
  const d = load();
  d.security.push({ ts: Date.now(), type, actor, detail });
  if (d.security.length > 200) d.security.shift();
  save();
}
function deny(actor: string, msg: string, status = 403): never { sec("BLOCKED", actor, msg); throw new Err(msg, status); }

/* ---------------------------------------------------------------- helpers */
const member = (name: string) => { const u = load().users[name]; if (!u) throw new Err("Not signed in", 401); return u; };
function verified(name: string) {
  const u = member(name);
  if (u.status === "blacklisted") deny(name, "Blacklisted");
  if (u.status !== "verified") deny(name, "Not verified");
  return u;
}
function admin(name: string) { const u = member(name); if (u.role !== "admin") deny(name, "Admin only"); return u; }
const num = (v: unknown, lo: number, hi: number, label: string) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new Err(`${label} must be a whole number from ${lo} to ${hi}`); return n; };
const str = (v: unknown, lo: number, hi: number, label: string) => { const s = String(v ?? "").trim(); if (s.length < lo || s.length > hi) throw new Err(`${label} must be ${lo}-${hi} characters`); return s; };
const loanOf = (id: unknown) => { const l = load().loans[String(id)]; if (!l) throw new Err("Loan not found", 404); return l; };
const activeLoan = (itemId: string) => Object.values(load().loans).find((l) => l.itemId === itemId && ["approved", "out", "disputed"].includes(l.status));
const rid = () => crypto.randomBytes(4).toString("hex");

/* -------------------------------------------------- fingerprint (tamper) */
export function fingerprintOf(it: Item): string {
  const p = readPhoto(it.id);
  return sha(JSON.stringify([it.title, it.category, it.description, it.condition, it.deposit, it.owner, p ? sha(p) : ""]));
}
export function integrityOf(it: Item): boolean {
  const b = load().ledger.find((x) => x.type === "LIST" && x.itemId === it.id);
  return !!b && b.fingerprint === fingerprintOf(it);
}

/* ------------------------------------------------------------ trust score */
export function trust(name: string) {
  const d = load();
  let clean = 0, late = 0, damaged = 0, lost = 0, lends = 0, careSum = 0, careN = 0;
  for (const l of Object.values(d.loans)) {
    if (l.status !== "returned" && l.status !== "resolved") continue;
    if (l.owner === name) lends++;
    if (l.borrower !== name) continue;
    if (l.status === "resolved") { if ((l.refundPct ?? 100) < 50) lost++; continue; }
    if (l.late) late++;
    if (l.damaged) damaged++;
    if (!l.late && !l.damaged) clean++;
    if (l.care) { careSum += l.care; careN++; }
  }
  const avgCare = careN ? careSum / careN : null;
  const raw = 50 + clean * 8 - late * 10 - damaged * 15 - lost * 25 + Math.min(lends * 3, 15) + (avgCare ? Math.round((avgCare - 3) * 5) : 0);
  return { score: Math.max(0, Math.min(100, raw)), clean, late, damaged, lost, lends, avgCare };
}

/* ------------------------------------------------------------- QR tokens */
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => crypto.createHmac("sha256", load().secret).update(payload).digest("hex").slice(0, 32);

export function makeToken(user: string, loanId: string, purpose: string) {
  const l = loanOf(loanId);
  if (l.borrower !== user) throw new Err("Only the borrower can make this code", 403);
  if (purpose === "handover" && l.status !== "approved") throw new Err("Nothing to hand over yet. The owner must approve first.");
  if (purpose === "return" && l.status !== "out") throw new Err("This item is not checked out.");
  if (purpose !== "handover" && purpose !== "return") throw new Err("Unknown code type");
  const exp = Date.now() + QR_TTL;
  const payload = `${l.id}.${l.borrower}.${purpose}.${exp}`;
  return { token: `${b64(payload)}.${sign(payload)}`, exp };
}

function parseToken(actor: string, token: string) {
  const [p, s] = String(token || "").split(".");
  let payload = "";
  try { payload = Buffer.from(p || "", "base64url").toString(); } catch { /* ignore */ }
  const ok = !!s && s.length === 32 && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(payload)));
  if (!payload || !ok) deny(actor, "QR signature invalid");
  const [loanId, borrower, purpose, exp] = payload.split(".");
  if (Date.now() > Number(exp)) { sec("BLOCKED", actor, "Expired QR code scanned"); throw new Err("This QR code has expired. Ask for a new one.", 410); }
  return { loan: loanOf(loanId), borrower, purpose, exp: Number(exp) };
}

export function peek(actor: string, token: string) {
  member(actor);
  const { loan, borrower, purpose, exp } = parseToken(actor, token);
  const it = load().items[loan.itemId];
  const stale = (purpose === "handover" && loan.status !== "approved") || (purpose === "return" && loan.status !== "out");
  return {
    purpose, borrower, exp, owner: loan.owner, canAct: loan.owner === actor && !stale, stale,
    item: { title: it.title, condition: loan.condOut ?? it.condition, deposit: it.deposit }, hours: loan.hours, dueAt: loan.dueAt ?? null,
  };
}

/* -------------------------------------------------- accounts & sessions */
const SESSION_TTL = 7 * 24 * 3600_000;
const hashPw = (pw: string) => { const salt = crypto.randomBytes(16).toString("hex"); return `${salt}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`; };
const checkPw = (pw: string, stored: string) => {
  const [salt, h] = stored.split(":");
  const a = Buffer.from(h || "", "hex"), b = crypto.scryptSync(pw, salt || "", 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const tries = () => (g.__tries ??= new Map());

function newSession(name: string) {
  const d = load(), now = Date.now();
  for (const [t, x] of Object.entries(d.sessions)) if (now - x.ts > SESSION_TTL) delete d.sessions[t];
  const token = crypto.randomBytes(24).toString("hex");
  d.sessions[token] = { name, ts: now };
  return token;
}

export function register(nameRaw: unknown, pwRaw: unknown) {
  const raw = String(nameRaw ?? "").trim(), name = cleanName(raw);
  if (name.length < 2 || raw.toLowerCase() !== name) throw new Err("Name must be 2-20 characters: letters, numbers, _ or -");
  const pw = String(pwRaw ?? "");
  if (pw.length < 6 || pw.length > 72) throw new Err("Password must be 6-72 characters");
  const d = load();
  if (d.users[name]) throw new Err("That name is taken. Sign in instead.", 409);
  const isAdmin = name === ADMIN;
  if (isAdmin && process.env.ADMIN_PASSWORD && pw !== process.env.ADMIN_PASSWORD) deny(name, "Wrong password for the admin account");
  d.users[name] = { address: addressOf(name), createdAt: Date.now(), role: isAdmin ? "admin" : "member", status: isAdmin ? "verified" : "pending", credits: 0, pass: hashPw(pw) };
  append("ACCOUNT", name, `${name} joined${isAdmin ? " as admin" : " and is waiting to be verified"}`);
  const token = newSession(name);
  sec("REGISTER", name, "Account created");
  return { name, token };
}

export function login(nameRaw: unknown, pwRaw: unknown) {
  const name = cleanName(nameRaw), d = load(), now = Date.now(), t = tries().get(name);
  if (t && t.until > now) throw new Err(`Too many wrong tries. Try again in ${Math.ceil((t.until - now) / 60000)} min.`, 429);
  const u = d.users[name];
  if (u && !u.pass) throw new Err("This account was made before passwords existed. Register a new name.", 403);
  if (!u || !checkPw(String(pwRaw ?? ""), u.pass!)) {
    const n = (t?.n ?? 0) + 1;
    tries().set(name, n >= 5 ? { n: 0, until: now + 5 * 60_000 } : { n, until: 0 });
    sec("LOGIN_FAILED", name || "?", n >= 5 ? "5 wrong passwords: locked for 5 minutes" : "Wrong name or password");
    throw new Err("Wrong name or password", 401);
  }
  tries().delete(name);
  const token = newSession(name);
  sec("LOGIN", name, "Signed in");
  return { name, token };
}

export function logout(token: string) {
  const d = load();
  if (d.sessions[token]) { delete d.sessions[token]; save(); }
}

// The server decides who you are from your session token. A name sent by the client is never trusted.
export function userFromReq(req: Request): string {
  const t = req.headers.get("x-session") || "", d = load(), x = d.sessions[t];
  if (!x || Date.now() - x.ts > SESSION_TTL || !d.users[x.name]) throw new Err("Please sign in again", 401);
  return x.name;
}

/* ----------------------------------------------------------------- actions */
export function perform(b: Record<string, unknown>): Record<string, unknown> {
  const actor = cleanName(b.actor), act = String(b.action), d = load(), now = Date.now();
  const me = member(actor);
  if (d.paused && me.role !== "admin") deny(actor, "Paused: the admin has frozen all activity");
  let out: Record<string, unknown> = {};

  switch (act) {
    case "listItem": {
      verified(actor);
      const title = str(b.title, 2, 60, "Title"), description = str(b.description, 0, 300, "Description");
      const category = CATEGORIES.includes(String(b.category)) ? String(b.category) : "Other";
      const condition = num(b.condition, 1, 5, "Condition"), deposit = num(b.deposit, 0, 500, "Deposit");
      let photo: Buffer | null = null;
      if (b.photo) {
        const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(b.photo));
        if (!m) throw new Err("Photo must be a JPEG, PNG or WebP image");
        photo = Buffer.from(m[2], "base64");
        if (photo.length > 1_500_000) throw new Err("Photo is too large");
      }
      const id = rid();
      if (photo) fs.writeFileSync(photoPath(id), photo);
      const it: Item = { id, title, category, description, condition, deposit, owner: actor, createdAt: now, hasPhoto: !!photo };
      d.items[id] = it;
      append("LIST", actor, `${actor} listed ${title} (condition ${condition}/5, deposit ${deposit})`, { itemId: id, fingerprint: fingerprintOf(it) });
      out = { id };
      break;
    }
    case "requestBorrow": {
      const u = verified(actor);
      const it = d.items[String(b.itemId)];
      if (!it) throw new Err("Item not found", 404);
      if (it.owner === actor) deny(actor, "Owners cannot borrow their own item");
      const hours = num(b.hours, 1, 168, "Hours");
      if (activeLoan(it.id)) throw new Err("This item is not available right now");
      if (Object.values(d.loans).some((l) => l.itemId === it.id && l.borrower === actor && l.status === "requested")) throw new Err("You already asked for this item");
      if (u.credits < it.deposit) throw new Err(`Not enough credits: deposit is ${it.deposit}, you have ${u.credits}`);
      const id = rid();
      d.loans[id] = { id, itemId: it.id, borrower: actor, owner: it.owner, hours, status: "requested", createdAt: now };
      append("REQUEST", actor, `${actor} asked to borrow ${it.title} for ${hours}h`, { itemId: it.id, loanId: id });
      break;
    }
    case "approve":
    case "reject": {
      const l = loanOf(b.loanId), it = d.items[l.itemId];
      if (l.owner !== actor) deny(actor, "Only the owner can do that");
      if (l.status !== "requested") throw new Err("This request is no longer open");
      if (act === "approve") {
        if (activeLoan(l.itemId)) throw new Err("Item is already promised to someone else");
        l.status = "approved"; l.approvedAt = now;
        append("APPROVE", actor, `${actor} approved ${l.borrower}'s request for ${it.title}`, { itemId: it.id, loanId: l.id });
      } else {
        l.status = "rejected";
        append("REJECT", actor, `${actor} declined ${l.borrower}'s request for ${it.title}`, { itemId: it.id, loanId: l.id });
      }
      break;
    }
    case "scan": {
      const { loan: l, purpose } = parseToken(actor, String(b.token));
      const it = d.items[l.itemId], borrower = d.users[l.borrower], owner = d.users[l.owner];
      if (l.owner !== actor) deny(actor, "Only the owner can confirm this code");
      const cond = num(b.condition, 1, 5, "Condition");
      if (purpose === "handover") {
        if (l.status !== "approved") throw new Err("This code was already used or is out of date");
        if (borrower.status !== "verified") deny(actor, "Borrower is not verified");
        if (borrower.credits < it.deposit) throw new Err("Borrower no longer has enough credits for the deposit");
        borrower.credits -= it.deposit;
        l.status = "out"; l.outAt = now; l.dueAt = now + l.hours * 3600_000; l.condOut = cond;
        append("HANDOVER", actor, `${actor} handed ${it.title} to ${l.borrower} (condition ${cond}/5, deposit ${it.deposit} held)`, { itemId: it.id, loanId: l.id });
        out = { kind: "handover", deposit: it.deposit };
      } else {
        if (l.status !== "out") throw new Err("This code was already used or is out of date");
        const care = num(b.care, 1, 5, "Care rating");
        const late = now > (l.dueAt ?? now), drop = Math.max(0, (l.condOut ?? cond) - cond);
        const pct = Math.min(100, (late ? 20 : 0) + drop * 25), kept = Math.round((it.deposit * pct) / 100);
        borrower.credits += it.deposit - kept; owner.credits += kept;
        l.status = "returned"; l.returnedAt = now; l.condIn = cond; l.care = care; l.kept = kept; l.refunded = it.deposit - kept; l.late = late; l.damaged = drop > 0;
        append("RETURN", actor, `${l.borrower} returned ${it.title} to ${actor}${late ? " late" : ""}${drop ? ", condition dropped" : ""}. Refunded ${l.refunded}, kept ${kept}`, { itemId: it.id, loanId: l.id });
        out = { kind: "return", refunded: l.refunded, kept, late, damaged: drop > 0 };
      }
      break;
    }
    case "dispute": {
      const l = loanOf(b.loanId), it = d.items[l.itemId];
      if (actor !== l.owner && actor !== l.borrower) deny(actor, "Only the owner or borrower can raise a dispute");
      if (l.status !== "out") throw new Err("Disputes can be raised while the item is checked out");
      l.status = "disputed"; l.disputeBy = actor; l.disputeReason = str(b.reason, 3, 200, "Reason");
      append("DISPUTE", actor, `${actor} raised a dispute over ${it.title}: ${l.disputeReason}`, { itemId: it.id, loanId: l.id });
      break;
    }
    case "resolve": {
      admin(actor);
      const l = loanOf(b.loanId), it = d.items[l.itemId];
      if (l.status !== "disputed") throw new Err("This loan is not in dispute");
      const pct = num(b.pct, 0, 100, "Refund share"), back = Math.round((it.deposit * pct) / 100);
      d.users[l.borrower].credits += back; d.users[l.owner].credits += it.deposit - back;
      l.status = "resolved"; l.refundPct = pct; l.refunded = back; l.kept = it.deposit - back; l.returnedAt = now;
      append("RESOLVE", actor, `admin settled the dispute over ${it.title}: ${pct}% of the deposit goes back to ${l.borrower}`, { itemId: it.id, loanId: l.id });
      break;
    }
    case "verify": {
      admin(actor);
      const t = cleanName(b.target), u = d.users[t];
      if (!u) throw new Err("No such member", 404);
      if (u.status === "verified") throw new Err("Already verified");
      if (u.status === "blacklisted") throw new Err("Unblock this member first");
      u.status = "verified"; u.credits += START_CREDITS;
      append("VERIFY", actor, `admin verified ${t} as a trusted member (+${START_CREDITS} credits)`);
      break;
    }
    case "blacklist": {
      admin(actor);
      const t = cleanName(b.target), u = d.users[t];
      if (!u) throw new Err("No such member", 404);
      if (u.role === "admin") throw new Err("Cannot blacklist an admin");
      const on = u.status !== "blacklisted";
      u.status = on ? "blacklisted" : "pending";
      append(on ? "BLACKLIST" : "UNBLOCK", actor, on ? `admin blacklisted ${t}` : `admin unblocked ${t} (needs verifying again)`);
      break;
    }
    case "pause": {
      admin(actor);
      d.paused = !d.paused;
      append(d.paused ? "PAUSE" : "UNPAUSE", actor, d.paused ? "admin paused everything (emergency freeze)" : "admin resumed activity");
      break;
    }
    case "alert": {
      verified(actor);
      const kind = ALERT_KINDS.includes(String(b.kind)) ? String(b.kind) : "Other";
      const message = str(b.message, 3, 140, "Message");
      d.alerts.push({ id: rid(), user: actor, kind, message, ts: now, open: true });
      append("ALERT", actor, `${actor} sent an urgent ${kind.toLowerCase()} request: ${message}`);
      break;
    }
    case "closeAlert": {
      const a = d.alerts.find((x) => x.id === String(b.id));
      if (!a) throw new Err("Alert not found", 404);
      if (a.user !== actor && me.role !== "admin") deny(actor, "Only the sender or admin can close this alert");
      a.open = false;
      break;
    }
    case "tamper": { // demo only: edits an item behind the ledger's back
      admin(actor);
      const it = d.items[String(b.itemId)];
      if (!it) throw new Err("Item not found", 404);
      it.description = it.description.endsWith(" [edited]") ? it.description.slice(0, -9) : it.description + " [edited]";
      sec("TAMPER_DEMO", actor, `Edited the description of ${it.title} directly in the database`);
      break;
    }
    default: throw new Err("Unknown action");
  }
  save();
  return out;
}

/* ------------------------------------------------------------------- view */
export function stateFor(user: string) {
  const d = load(), me = member(user), now = Date.now();
  const busy = (id: string) => activeLoan(id)?.status ?? "available";
  return {
    me: { name: user, address: me.address, role: me.role, status: me.status, credits: me.credits, trust: trust(user) },
    paused: d.paused,
    users: Object.entries(d.users).map(([name, u]) => ({ name, role: u.role, status: u.status, credits: u.credits, score: trust(name).score })),
    items: Object.values(d.items).sort((a, b) => b.createdAt - a.createdAt).map((it) => ({ ...it, integrity: integrityOf(it), state: busy(it.id), ownerScore: trust(it.owner).score })),
    loans: Object.values(d.loans).sort((a, b) => b.createdAt - a.createdAt).map((l) => ({ ...l, itemTitle: d.items[l.itemId]?.title ?? "?", deposit: d.items[l.itemId]?.deposit ?? 0, overdue: l.status === "out" && now > (l.dueAt ?? Infinity) })),
    alerts: d.alerts.filter((a) => a.open).slice(-10).reverse(),
    ledger: d.ledger.slice(-60).reverse(), ledgerLength: d.ledger.length, chainValid: chainValid(),
    security: me.role === "admin" ? d.security.slice(-40).reverse() : [],
  };
}
