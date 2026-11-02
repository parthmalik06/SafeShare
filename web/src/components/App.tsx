"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ago, authFetch, deviceLabel, inTime, resizeImage } from "@/lib/client";

/* ---------------------------------------------------------------- types */
type Trust = { score: number; clean: number; late: number; damaged: number; lost: number; lends: number; avgCare: number | null };
type Me = { name: string; address: string; role: "admin" | "member"; status: "pending" | "verified" | "blacklisted"; credits: number; trust: Trust };
type Item = { id: string; title: string; category: string; description: string; condition: number; deposit: number; owner: string; hasPhoto: boolean; integrity: boolean; state: string; ownerScore: number };
type Loan = { id: string; itemId: string; itemTitle: string; deposit: number; borrower: string; owner: string; hours: number; status: string; createdAt: number; dueAt?: number; overdue: boolean; refunded?: number; kept?: number; late?: boolean; damaged?: boolean; care?: number; disputeReason?: string; disputeBy?: string; refundPct?: number };
type Alert = { id: string; user: string; kind: string; message: string; ts: number };
type Block = { index: number; ts: number; type: string; actor: string; detail: string; fingerprint?: string; prev: string; hash: string };
type Device = { user: string; deviceId: string; label: string; page: string; seen: number; online: boolean };
type State = {
  me: Me; paused: boolean; users: { name: string; role: string; status: string; credits: number; score: number }[];
  items: Item[]; loans: Loan[]; alerts: Alert[]; ledger: Block[]; ledgerLength: number; chainValid: boolean;
  security: { ts: number; type: string; actor: string; detail: string }[]; devices: Device[];
};
type Tab = "items" | "loans" | "activity" | "admin" | "help";
type Say = (m: string) => void;

const CATS = ["Generator", "Water pump", "First-aid kit", "Oxygen cylinder", "Boat", "Tent", "Other"];
const ICON: Record<string, string> = { Generator: "⚡", "Water pump": "💧", "First-aid kit": "🩹", "Oxygen cylinder": "🫁", Boat: "🛶", Tent: "⛺", Other: "📦" };
const KINDS = ["Water", "Medical", "Power", "Shelter", "Rescue", "Other"];
const LEDGER_ICON: Record<string, string> = { ACCOUNT: "👤", VERIFY: "✅", LIST: "📝", REQUEST: "🔔", APPROVE: "👍", REJECT: "✋", HANDOVER: "🤝", RETURN: "↩️", DISPUTE: "⚖️", RESOLVE: "🧾", BLACKLIST: "🚫", UNBLOCK: "♻️", PAUSE: "⏸️", UNPAUSE: "▶️", ALERT: "🚨" };
const STATUS: Record<string, [string, string]> = {
  requested: ["Waiting for owner", "bg-warn-soft text-warn"], approved: ["Approved: hand over", "bg-accent-soft text-accent-ink"],
  out: ["Checked out", "bg-accent-soft text-accent-ink"], returned: ["Returned", "bg-ok-soft text-ok"], rejected: ["Declined", "bg-surface2 text-muted"],
  disputed: ["In dispute", "bg-warn-soft text-danger"], resolved: ["Settled by admin", "bg-ok-soft text-ok"],
};

const post = (url: string, body: unknown) =>
  authFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, data: await r.json() }));
const delay = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 60}ms` });
const extractToken = (t: string) => { const s = t.trim(); const i = s.indexOf("/scan/"); return decodeURIComponent(i >= 0 ? s.slice(i + 6).split(/[?#]/)[0] : s); };

/* ---------------------------------------------------------------- theme */
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("ss-theme", next ? "dark" : "light"); } catch { /* ignore */ }
    setDark(next);
  };
  return <button onClick={toggle} aria-label="Toggle dark mode" className="btn btn-ghost h-10 w-10 !p-0 text-lg">{dark ? "☀️" : "🌙"}</button>;
}

/* ---------------------------------------------------------------- root */
export default function App({ scanToken, authMode }: { scanToken?: string; authMode?: "login" | "register" }) {
  const [name, setName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>("items");
  const [toast, setToast] = useState("");
  const deviceId = useRef("");

  const say = useCallback<Say>((m) => { setToast(m); setTimeout(() => setToast(""), 3500); }, []);

  // Each browser tab = its own "device" and session, so one PC can play several people.
  useEffect(() => {
    deviceId.current = sessionStorage.getItem("ss-device") || Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem("ss-device", deviceId.current);
    setName(sessionStorage.getItem("ss-token") ? sessionStorage.getItem("ss-name") : null);
    setReady(true);
  }, []);

  const logout = useCallback(() => {
    post("/api/login", { logout: true }).catch(() => {});
    sessionStorage.removeItem("ss-name"); sessionStorage.removeItem("ss-token");
    setName(null); setState(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!name) return;
    try {
      const r = await authFetch("/api/state", { cache: "no-store" });
      if (r.status === 401) return logout();
      setState(await r.json());
    } catch { /* offline */ }
  }, [name, logout]);

  useEffect(() => {
    if (!name) return;
    const beat = () => post("/api/presence", { user: name, deviceId: deviceId.current, label: deviceLabel(), page: scanToken ? "Scanning a QR code" : `${tab} tab` });
    refresh(); beat();
    const a = setInterval(refresh, 2000), b = setInterval(beat, 5000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [name, tab, scanToken, refresh]);

  if (!ready) return null;
  if (!name) return <Auth scanToken={scanToken} initial={authMode ?? "login"} onLogin={(n, token) => {
    sessionStorage.setItem("ss-name", n); sessionStorage.setItem("ss-token", token); setName(n);
    if (!scanToken && location.pathname !== "/") history.replaceState(null, "", "/");
  }} />;

  const me = state?.me;
  const tabs: { k: Tab; label: string }[] = [{ k: "items", label: "Items" }, { k: "loans", label: "My loans" }, { k: "activity", label: "Activity" }, ...(me?.role === "admin" ? [{ k: "admin" as Tab, label: "Admin" }] : []), { k: "help", label: "Help" }];
  const idx = Math.max(0, tabs.findIndex((t) => t.k === tab));

  return (
    <div className="mx-auto max-w-4xl px-5 pb-28 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <a href="/" className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-xl text-white shadow-lg">🛟</span>
          <span className="leading-tight"><span className="block text-xl font-semibold tracking-tight">SafeShare</span><span className="block text-xs text-muted">Trust in every transaction</span></span>
        </a>
        <div className="flex items-center gap-3">
          <div className="text-right leading-snug">
            <div className="text-sm font-semibold">@{name}{me?.role === "admin" && <span className="chip ml-2 bg-accent-soft !py-0 text-accent-ink">admin</span>}</div>
            {me && <div className="text-xs text-muted">{me.status === "verified" ? <><span className="text-ok">✔ verified</span> · {me.credits} credits · trust {me.trust.score}</> : me.status === "pending" ? <span className="text-warn">⏳ waiting for verification</span> : <span className="text-danger">blacklisted</span>}</div>}
          </div>
          <ThemeToggle />
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      {state?.paused && <div className="anim-pop mb-5 rounded-2xl bg-warn-soft p-4 text-sm text-danger">⏸ <b>Emergency pause is on.</b> The admin has frozen all activity until further notice.</div>}

      {scanToken ? (
        state && <div className="anim-in"><ScanConfirm token={scanToken} me={state.me} say={say} done={() => { window.location.href = "/"; }} /></div>
      ) : !state ? <p className="text-muted">Loading…</p> : (
        <>
          <Alerts state={state} say={say} refresh={refresh} />
          <nav className="relative mb-8 grid rounded-2xl border border-line bg-surface2 p-1.5 text-sm font-medium" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
            <span className="absolute inset-y-1.5 left-1.5 rounded-xl bg-bg shadow-sm ring-1 ring-line transition-transform duration-300 ease-out"
              style={{ width: `calc((100% - 0.75rem) / ${tabs.length})`, transform: `translateX(${idx * 100}%)` }} />
            {tabs.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)} className={`relative z-10 rounded-xl px-2 py-2.5 transition-colors ${tab === t.k ? "text-ink" : "text-muted hover:text-ink"}`}>{t.label}</button>
            ))}
          </nav>
          <div key={tab} className="anim-in">
            {tab === "items" ? <Items state={state} say={say} refresh={refresh} />
              : tab === "loans" ? <Loans state={state} say={say} refresh={refresh} />
              : tab === "activity" ? <Activity state={state} />
              : tab === "admin" ? <Admin state={state} say={say} refresh={refresh} />
              : <Help setTab={setTab} />}
          </div>
        </>
      )}

      {toast && <div className="anim-toast fixed bottom-8 left-1/2 z-30 max-w-[90vw] -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-center text-sm font-medium text-bg shadow-2xl">{toast}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- Sign in / Register */
function Auth({ onLogin, scanToken, initial }: { onLogin: (n: string, token: string) => void; scanToken?: string; initial: "login" | "register" }) {
  const [mode, setMode] = useState<"login" | "register">(initial);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const reg = mode === "register";
  const switchTo = (m: "login" | "register") => {
    setMode(m); setErr(""); setPw(""); setPw2("");
    if (!scanToken) history.replaceState(null, "", m === "register" ? "/register" : "/");
  };
  const go = async () => {
    setErr("");
    if (reg && pw !== pw2) return setErr("The two passwords don’t match");
    setBusy(true);
    try {
      const r = await post(reg ? "/api/register" : "/api/login", { name, password: pw });
      if (r.ok) onLogin(r.data.name, r.data.token); else setErr(r.data.error);
    } catch { setErr("Can’t reach the server"); } finally { setBusy(false); }
  };
  const enter = (e: React.KeyboardEvent) => e.key === "Enter" && go();
  return (
    <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="absolute right-6 top-6"><ThemeToggle /></div>
      <div className="anim-in mb-10 text-center">
        <div className="anim-float mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-accent text-4xl text-white shadow-xl">🛟</div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">SafeShare</h1>
        <p className="mt-3 text-muted">Neighbours lending generators, pumps, first-aid kits<br />and boats when it matters most.</p>
      </div>
      {scanToken && <div className="anim-in mb-5 rounded-2xl bg-accent-soft p-4 text-sm text-accent-ink" style={delay(1)}>You scanned a SafeShare handover code. Sign in as the <b>item owner</b> to confirm it.</div>}
      <div className="card anim-in" style={delay(2)}>
        <h2 className="text-lg font-semibold">{reg ? "Create your account" : "Sign in"}</h2>
        <label className="mt-5 block text-sm font-medium">Name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={enter} placeholder="e.g. alice" autoCapitalize="none" autoComplete="username" className="input mt-2" />
        {reg && <p className="mt-1.5 text-xs text-muted">Letters, numbers, _ or - (2–20 characters). Others see this name.</p>}
        <label className="mt-4 block text-sm font-medium">Password</label>
        <div className="relative mt-2">
          <input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={enter} placeholder={reg ? "At least 6 characters" : "Your password"} autoComplete={reg ? "new-password" : "current-password"} className="input !pr-16" />
          <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-3 text-xs font-medium text-muted hover:text-ink">{show ? "Hide" : "Show"}</button>
        </div>
        {reg && (<>
          <label className="mt-4 block text-sm font-medium">Confirm password</label>
          <input type={show ? "text" : "password"} value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={enter} placeholder="Type it again" autoComplete="new-password" className="input mt-2" />
        </>)}
        {err && <p className="anim-pop mt-4 rounded-xl bg-warn-soft px-3 py-2 text-sm text-danger">{err}</p>}
        <button className="btn btn-primary mt-5 w-full py-3" disabled={busy || name.trim().length < 2 || pw.length < 1} onClick={go}>{busy ? "Please wait…" : reg ? "Create account →" : "Sign in →"}</button>
        <p className="mt-5 text-center text-sm text-muted">
          {reg ? "Already have an account? " : "New to SafeShare? "}
          <button className="font-semibold text-accent-ink hover:underline" onClick={() => switchTo(reg ? "login" : "register")}>{reg ? "Sign in" : "Create an account"}</button>
        </p>
        {reg && <p className="mt-4 text-xs leading-relaxed text-muted">New members start as <b>pending</b> until the admin verifies them. The name <b>admin</b> is the administrator, so register it first.</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Urgent alerts */
function Alerts({ state, say, refresh }: { state: State; say: Say; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("Water");
  const [msg, setMsg] = useState("");
  const me = state.me;
  const send = async () => {
    const r = await post("/api/act", { actor: me.name, action: "alert", kind, message: msg });
    if (!r.ok) return say(r.data.error);
    setMsg(""); setOpen(false); say("Urgent request sent to every member"); refresh();
  };
  const close = async (id: string) => { const r = await post("/api/act", { actor: me.name, action: "closeAlert", id }); if (!r.ok) say(r.data.error); refresh(); };
  return (
    <div className="mb-6 space-y-3">
      {state.alerts.map((a) => (
        <div key={a.id} className="anim-pop flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/40 bg-warn-soft p-4 text-sm">
          <span>🚨 <b>Urgent · {a.kind}</b> from @{a.user}: {a.message} <span className="text-xs text-muted">{ago(a.ts)}</span></span>
          {(a.user === me.name || me.role === "admin") && <button className="btn btn-ghost !py-1" onClick={() => close(a.id)}>Mark solved</button>}
        </div>
      ))}
      {open ? (
        <div className="card anim-pop space-y-3">
          <div className="text-sm font-semibold">What do you urgently need?</div>
          <div className="flex flex-wrap gap-2">{KINDS.map((k) => <button key={k} onClick={() => setKind(k)} className={`chip border ${kind === k ? "border-accent bg-accent-soft text-accent-ink" : "border-line"}`}>{k}</button>)}</div>
          <input className="input" value={msg} maxLength={140} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. Need a water pump, ground floor is flooding" />
          <div className="flex gap-3"><button className="btn btn-primary" disabled={msg.trim().length < 3} onClick={send}>Send to everyone</button><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
      ) : <button className="btn btn-ghost w-full border-danger/40 py-3 text-danger" onClick={() => setOpen(true)}>🚨 Urgent request</button>}
    </div>
  );
}

/* ---------------------------------------------------------------- Items */
function Items({ state, say, refresh }: { state: State; say: Say; refresh: () => void }) {
  const [form, setForm] = useState(false);
  const [filter, setFilter] = useState("All");
  const me = state.me;
  const items = state.items.filter((i) => filter === "All" || i.category === filter);
  return (
    <div className="space-y-8">
      {me.status === "pending" && <div className="rounded-2xl bg-warn-soft p-4 text-sm text-warn">⏳ You can browse, but you can’t list or borrow until the admin verifies you. Ask them to open the <b>Admin</b> tab and press Verify.</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">{["All", ...CATS].map((c) => <button key={c} onClick={() => setFilter(c)} className={`chip border ${filter === c ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-muted"}`}>{c}</button>)}</div>
        <button className="btn btn-primary" onClick={() => setForm(!form)}>{form ? "Close" : "＋ List an item"}</button>
      </div>
      {form && <ListForm me={me} say={say} done={() => { setForm(false); refresh(); }} />}
      {items.length === 0 ? <div className="card text-center text-muted">Nothing listed yet. Be the first to add a generator, pump or first-aid kit.</div> : (
        <div className="grid gap-5 sm:grid-cols-2">{items.map((it, i) => <ItemCard key={it.id} it={it} i={i} me={me} say={say} refresh={refresh} />)}</div>
      )}
    </div>
  );
}

function ListForm({ me, say, done }: { me: Me; say: Say; done: () => void }) {
  const [f, setF] = useState({ title: "", category: "Generator", description: "", condition: 4, deposit: 30 });
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | number) => setF((p) => ({ ...p, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      const r = await post("/api/act", { actor: me.name, action: "listItem", ...f, condition: Number(f.condition), deposit: Number(f.deposit), photo });
      if (!r.ok) return say(r.data.error);
      say("Listed ✔ Its fingerprint is now in the ledger"); done();
    } finally { setBusy(false); }
  };
  return (
    <div className="card anim-pop space-y-4">
      <h3 className="text-lg font-semibold">List an item</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="text-xs font-medium text-muted">Title</label><input className="input mt-1" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Portable generator" /></div>
        <div><label className="text-xs font-medium text-muted">Category</label><select className="input mt-1" value={f.category} onChange={(e) => set("category", e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="text-xs font-medium text-muted">Condition (1 poor – 5 like new)</label><select className="input mt-1" value={f.condition} onChange={(e) => set("condition", Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></div>
        <div><label className="text-xs font-medium text-muted">Deposit (credits)</label><input type="number" min={0} max={500} className="input mt-1" value={f.deposit} onChange={(e) => set("deposit", e.target.value)} /></div>
      </div>
      <div><label className="text-xs font-medium text-muted">Description</label><textarea className="input mt-1" rows={2} maxLength={300} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="5 kVA, petrol, fuel not included" /></div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="btn btn-ghost cursor-pointer">📷 {photo ? "Change photo" : "Add photo"}
          <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { try { setPhoto(await resizeImage(file)); } catch (er) { say(er instanceof Error ? er.message : "Bad image"); } } }} />
        </label>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo && <img src={photo} alt="preview" className="h-16 w-16 rounded-xl border border-line object-cover" />}
      </div>
      <button className="btn btn-primary" disabled={busy || f.title.trim().length < 2} onClick={submit}>{busy ? "Registering…" : "Register on the ledger"}</button>
    </div>
  );
}

function ItemCard({ it, me, say, refresh, i }: { it: Item; me: Me; say: Say; refresh: () => void; i: number }) {
  const [hours, setHours] = useState(24);
  const mine = it.owner === me.name;
  const borrow = async () => {
    const r = await post("/api/act", { actor: me.name, action: "requestBorrow", itemId: it.id, hours });
    say(r.ok ? "Request sent to the owner" : r.data.error); refresh();
  };
  const stateChip = it.state === "available" ? ["Available", "bg-ok-soft text-ok"] : it.state === "approved" ? ["Reserved", "bg-warn-soft text-warn"] : it.state === "disputed" ? ["In dispute", "bg-warn-soft text-danger"] : ["Lent out", "bg-accent-soft text-accent-ink"];
  return (
    <div className={`card card-hover anim-in flex flex-col !p-0 overflow-hidden ${it.integrity ? "" : "!border-danger"}`} style={delay(i)}>
      {it.hasPhoto
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={`/api/photos/${it.id}?v=${it.integrity ? 1 : 0}`} alt={it.title} className="h-40 w-full object-cover" />
        : <div className="grid h-40 place-items-center bg-surface2 text-5xl">{ICON[it.category] ?? "📦"}</div>}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="truncate font-semibold">{it.title}</div><div className="mt-0.5 text-xs text-muted">{ICON[it.category]} {it.category} · @{it.owner} (trust {it.ownerScore})</div></div>
          <span className={`chip shrink-0 ${stateChip[1]}`}>{stateChip[0]}</span>
        </div>
        {it.description && <p className="text-sm text-muted">{it.description}</p>}
        <div className="flex flex-wrap gap-2 text-xs"><span className="chip bg-surface2">Condition {it.condition}/5</span><span className="chip bg-surface2">Deposit {it.deposit}</span>
          {it.integrity ? <span className="chip bg-ok-soft text-ok">✔ Integrity verified</span> : <span className="chip bg-warn-soft font-bold text-danger">⚠ TAMPERED</span>}</div>
        {!it.integrity && <p className="text-xs text-danger">The details or photo no longer match the fingerprint saved on the ledger when this was listed. Do not trust this listing.</p>}
        <div className="mt-auto">
          {mine ? <span className="text-xs text-muted">Your item</span> : (
            <div className="flex items-center gap-3">
              <select className="input !w-auto" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[1, 4, 24, 48, 72].map((h) => <option key={h} value={h}>{h}h</option>)}</select>
              <button className="btn btn-primary flex-1" disabled={it.state !== "available"} onClick={borrow}>Borrow</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Loans */
function Loans({ state, say, refresh }: { state: State; say: Say; refresh: () => void }) {
  const me = state.me;
  const [qr, setQr] = useState<{ loan: Loan; purpose: "handover" | "return" } | null>(null);
  const [scan, setScan] = useState(false);
  const lending = state.loans.filter((l) => l.owner === me.name), borrowing = state.loans.filter((l) => l.borrower === me.name);
  const act = async (action: string, extra: Record<string, unknown>) => { const r = await post("/api/act", { actor: me.name, action, ...extra }); if (!r.ok) say(r.data.error); refresh(); };
  const dispute = (l: Loan) => { const reason = window.prompt("What went wrong? (e.g. item not returned)"); if (reason) act("dispute", { loanId: l.id, reason }); };
  const section = (title: string, list: Loan[], owner: boolean) => (
    <section>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {list.length === 0 ? <div className="card text-center text-muted">Nothing here yet.</div> : (
        <div className="space-y-4">{list.map((l, i) => <LoanCard key={l.id} l={l} i={i} owner={owner} act={act} dispute={dispute} showQR={(p) => setQr({ loan: l, purpose: p })} />)}</div>
      )}
    </section>
  );
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-accent-soft p-4 text-sm text-accent-ink">
        <span>Handing over or taking back an item? The <b>owner</b> scans the borrower’s QR code.</span>
        <button className="btn btn-primary" onClick={() => setScan(true)}>📷 Scan a QR code</button>
      </div>
      {section("Items I’m lending", lending, true)}
      {section("Items I’m borrowing", borrowing, false)}
      {qr && <QRModal loan={qr.loan} purpose={qr.purpose} me={me} onClose={() => setQr(null)} />}
      {scan && <ScanModal me={me} say={say} onClose={() => { setScan(false); refresh(); }} />}
    </div>
  );
}

function LoanCard({ l, owner, act, dispute, showQR, i }: { l: Loan; owner: boolean; act: (a: string, e: Record<string, unknown>) => void; dispute: (l: Loan) => void; showQR: (p: "handover" | "return") => void; i: number }) {
  const [label, cls] = STATUS[l.status] ?? [l.status, "bg-surface2"];
  return (
    <div className="card card-hover anim-in space-y-4" style={delay(i)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="font-semibold">{l.itemTitle}</div><div className="mt-1 text-xs text-muted">@{l.borrower} borrows from @{l.owner} · {l.hours}h · deposit {l.deposit}</div></div>
        <span className={`chip ${cls}`}>{l.overdue ? "Overdue" : label}</span>
      </div>
      {l.status === "out" && l.dueAt && <div className={`text-sm ${l.overdue ? "text-danger" : "text-muted"}`}>Due {inTime(l.dueAt)}</div>}
      {l.status === "returned" && <div className="text-sm text-muted">Refunded {l.refunded}, kept {l.kept}{l.late ? " · late" : ""}{l.damaged ? " · condition dropped" : ""} · care {l.care}/5</div>}
      {l.status === "disputed" && <div className="text-sm text-danger">@{l.disputeBy}: “{l.disputeReason}”. Waiting for the admin.</div>}
      {l.status === "resolved" && <div className="text-sm text-muted">{l.refundPct}% of the deposit went back to @{l.borrower}.</div>}
      <div className="flex flex-wrap gap-2">
        {owner && l.status === "requested" && <><button className="btn btn-primary" onClick={() => act("approve", { loanId: l.id })}>Approve</button><button className="btn btn-ghost" onClick={() => act("reject", { loanId: l.id })}>Decline</button></>}
        {!owner && l.status === "requested" && <span className="text-sm text-muted">Waiting for @{l.owner} to approve…</span>}
        {!owner && l.status === "approved" && <button className="btn btn-primary" onClick={() => showQR("handover")}>📱 My QR</button>}
        {owner && l.status === "approved" && <span className="text-sm text-muted">Approved. Scan @{l.borrower}’s QR to hand it over.</span>}
        {!owner && l.status === "out" && <button className="btn btn-primary" onClick={() => showQR("return")}>↩ Start return</button>}
        {owner && l.status === "out" && <span className="text-sm text-muted">When it comes back, scan @{l.borrower}’s return QR.</span>}
        {l.status === "out" && <button className="btn btn-ghost" onClick={() => dispute(l)}>⚖️ Raise dispute</button>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- QR (borrower side) */
function QRModal({ loan, purpose, me, onClose }: { loan: Loan; purpose: "handover" | "return"; me: Me; onClose: () => void }) {
  const [img, setImg] = useState("");
  const [tok, setTok] = useState<{ token: string; exp: number } | null>(null);
  const [base, setBase] = useState("");
  const [nets, setNets] = useState<{ name: string; address: string }[]>([]);
  const [err, setErr] = useState("");
  const [, tick] = useState(0);
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  // On localhost a phone can't reach "localhost", so use this PC's Wi-Fi address (remembering a manual choice).
  useEffect(() => {
    (async () => {
      if (!local) return setBase(location.origin);
      const { nets: n } = await (await fetch("/api/info")).json();
      setNets(n);
      let saved = "";
      try { saved = localStorage.getItem("ss-host") || ""; } catch { /* ignore */ }
      const pick = n.find((x: { address: string }) => x.address === saved)?.address || n[0]?.address;
      setBase(pick ? `${location.protocol}//${pick}:${location.port || 80}` : location.origin);
    })();
  }, [local]);

  const make = useCallback(async () => {
    setErr("");
    const r = await authFetch(`/api/qr?loan=${loan.id}&purpose=${purpose}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) return setErr(d.error);
    setTok(d);
  }, [me.name, loan.id, purpose]);
  useEffect(() => { make(); const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [make]);

  const link = tok && base ? `${base}/scan/${encodeURIComponent(tok.token)}` : "";
  useEffect(() => { if (link) QRCode.toDataURL(link, { width: 360, margin: 2, errorCorrectionLevel: "L" }).then(setImg); }, [link]);
  const choose = (address: string) => {
    try { localStorage.setItem("ss-host", address); } catch { /* ignore */ }
    setBase(`${location.protocol}//${address}:${location.port || 80}`);
  };
  const left = tok ? Math.max(0, Math.round((tok.exp - Date.now()) / 1000)) : 0;
  return (
    <div className="anim-fade fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/50 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="card anim-pop my-auto w-full max-w-sm bg-bg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{purpose === "handover" ? "Show this to the owner" : "Return QR"}</h3>
        <p className="mt-1 text-sm text-muted">{purpose === "handover" ? `@${loan.owner} scans this to hand over` : `@${loan.owner} scans this to take back`} “{loan.itemTitle}”. It works for one person, one item, and 10 minutes.</p>
        <div className="my-5 grid place-items-center">
          {err ? <p className="text-sm text-danger">{err}</p>
            // eslint-disable-next-line @next/next/no-img-element
            : img ? <img src={img} alt="QR" className="anim-pop rounded-2xl border border-line bg-white p-2" width={260} height={260} /> : <div className="h-64 w-64 rounded-2xl bg-surface2" />}
        </div>
        {tok && <p className={`text-center text-sm ${left === 0 ? "text-danger" : "text-muted"}`}>{left === 0 ? "Expired" : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</p>}
        {local && nets.length > 0 && (
          <div className="mt-4 rounded-2xl bg-surface2 p-3 text-xs text-muted">
            <div className="mb-2">Phone can’t open the link? Pick the address of your Wi-Fi:</div>
            <div className="flex flex-wrap gap-2">{nets.map((n) => <button key={n.address} onClick={() => choose(n.address)} className={`chip border ${base.includes(`//${n.address}:`) ? "border-accent bg-accent-soft text-accent-ink" : "border-line"}`}>{n.address} <span className="opacity-60">{n.name}</span></button>)}</div>
          </div>
        )}
        <div className="mt-5 flex gap-3">
          <button className="btn btn-ghost flex-1" onClick={make}>New code</button>
          <button className="btn btn-ghost flex-1" disabled={!link} onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Scan (owner side) */
function Scanner({ onToken }: { onToken: (t: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const [err, setErr] = useState("");
  useEffect(() => {
    let stop = false, stream: MediaStream | null = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This page can’t use the camera over plain http. Scan with your phone’s normal camera app instead, or paste the code below.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = video.current!;
        v.srcObject = stream; await v.play();
        const jsQR = (await import("jsqr")).default;
        const c = document.createElement("canvas"), ctx = c.getContext("2d", { willReadFrequently: true })!;
        const tick = () => {
          if (stop) return;
          if (v.videoWidth) {
            c.width = v.videoWidth; c.height = v.videoHeight; ctx.drawImage(v, 0, 0);
            const im = ctx.getImageData(0, 0, c.width, c.height), r = jsQR(im.data, im.width, im.height);
            if (r?.data) return cb.current(r.data);
          }
          setTimeout(tick, 200);
        };
        tick();
      } catch (e) { setErr(e instanceof Error ? e.message : "Camera unavailable"); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return err ? <p className="rounded-2xl bg-warn-soft p-4 text-sm text-warn">{err}</p> : <video ref={video} playsInline muted className="aspect-square w-full rounded-2xl bg-black object-cover" />;
}

function ScanModal({ me, say, onClose }: { me: Me; say: Say; onClose: () => void }) {
  const [token, setToken] = useState("");
  const [paste, setPaste] = useState("");
  const fromImage = async (file: File) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = async () => {
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0);
      const jsQR = (await import("jsqr")).default, im = ctx.getImageData(0, 0, c.width, c.height), r = jsQR(im.data, im.width, im.height);
      URL.revokeObjectURL(url);
      if (r?.data) setToken(extractToken(r.data)); else say("No QR code found in that picture");
    };
    img.src = url;
  };
  return (
    <div className="anim-fade fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/50 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="card anim-pop my-auto w-full max-w-md bg-bg" onClick={(e) => e.stopPropagation()}>
        {token ? <ScanConfirm token={token} me={me} say={say} done={onClose} back={() => setToken("")} /> : (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Scan the borrower’s QR</h3>
            <Scanner onToken={(t) => setToken(extractToken(t))} />
            <div className="space-y-3 border-t border-line pt-4">
              <label className="btn btn-ghost w-full cursor-pointer">🖼 Use a photo of the QR<input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) fromImage(f); }} /></label>
              <div className="flex gap-2"><input className="input" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="…or paste the link / code" /><button className="btn btn-primary" disabled={!paste.trim()} onClick={() => setToken(extractToken(paste))}>Go</button></div>
            </div>
            <button className="btn btn-ghost w-full" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

type Peek = { purpose: "handover" | "return"; borrower: string; owner: string; canAct: boolean; stale: boolean; item: { title: string; condition: number; deposit: number }; hours: number; dueAt: number | null; error?: string };
function ScanConfirm({ token, me, say, done, back }: { token: string; me: Me; say: Say; done: () => void; back?: () => void }) {
  const [p, setP] = useState<Peek | null>(null);
  const [cond, setCond] = useState(4);
  const [care, setCare] = useState(5);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const r = await authFetch(`/api/qr?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const d = await r.json();
      setP(d);
      if (d.item) setCond(d.item.condition);
    })();
  }, [token, me.name]);
  const confirm = async () => {
    setBusy(true);
    const r = await post("/api/act", { actor: me.name, action: "scan", token, condition: cond, care });
    setBusy(false);
    if (!r.ok) return setMsg(r.data.error);
    const d = r.data;
    setMsg(d.kind === "handover" ? `Handed over ✔ ${d.deposit} credits are held as deposit.` : `Returned ✔ Refunded ${d.refunded}, kept ${d.kept}${d.late ? " (late)" : ""}${d.damaged ? " (condition dropped)" : ""}.`);
    say("Recorded on the ledger");
    setP((x) => (x ? { ...x, canAct: false, stale: true } : x));
  };
  if (!p) return <p className="text-muted">Reading the code…</p>;
  if (p.error) return <div className="space-y-4"><div className="text-3xl">❌</div><h3 className="text-lg font-semibold">Code refused</h3><p className="text-danger">{p.error}</p><div className="flex gap-3">{back && <button className="btn btn-ghost" onClick={back}>Try again</button>}<button className="btn btn-primary" onClick={done}>Close</button></div></div>;
  const ret = p.purpose === "return";
  return (
    <div className="space-y-5">
      <div>
        <span className="chip bg-ok-soft text-ok">✔ Signature valid</span>
        <h3 className="mt-3 text-xl font-semibold">{ret ? "Take back" : "Hand over"} “{p.item.title}”</h3>
        <p className="mt-1 text-sm text-muted">{ret ? `From @${p.borrower}` : `To @${p.borrower}`} · {p.hours}h · deposit {p.item.deposit}</p>
      </div>
      {!p.canAct && !msg && <div className="rounded-2xl bg-warn-soft p-4 text-sm text-warn">{p.owner !== me.name ? `Only @${p.owner}, the owner, can confirm this code. You are signed in as @${me.name}.` : "This code was already used or is out of date."}</div>}
      {p.canAct && (
        <>
          <div><label className="text-sm font-medium">Condition {ret ? "now" : "at handover"} (1–5)</label>
            <div className="mt-2 flex gap-2">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setCond(n)} className={`btn flex-1 ${cond === n ? "btn-primary" : "btn-ghost"}`}>{n}</button>)}</div>
            {ret && <p className="mt-2 text-xs text-muted">Was {p.item.condition}/5 when it left. A lower number keeps part of the deposit.</p>}</div>
          {ret && <div><label className="text-sm font-medium">How well did @{p.borrower} care for it? (1–5)</label>
            <div className="mt-2 flex gap-2">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setCare(n)} className={`btn flex-1 ${care === n ? "btn-primary" : "btn-ghost"}`}>{n}</button>)}</div></div>}
          <button className="btn btn-primary w-full py-3" disabled={busy} onClick={confirm}>{busy ? "Recording…" : ret ? "Confirm return" : "Confirm handover"}</button>
        </>
      )}
      {msg && <p className={`rounded-2xl p-4 text-sm ${msg.includes("✔") ? "bg-ok-soft text-ok" : "bg-warn-soft text-danger"}`}>{msg}</p>}
      {(msg || !p.canAct) && <button className="btn btn-ghost w-full" onClick={done}>Close</button>}
    </div>
  );
}

/* ---------------------------------------------------------------- Activity */
function Activity({ state }: { state: State }) {
  return (
    <div className="space-y-8">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Live activity</h3>
          <span className={`chip ${state.chainValid ? "bg-ok-soft text-ok" : "bg-warn-soft text-danger"}`}>{state.chainValid ? `✔ Chain valid · ${state.ledgerLength} blocks` : "✘ Chain broken"}</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">Every step is a block whose hash includes the previous block’s hash. Changing history would change every later hash, so tampering is detectable.</p>
        <div className="mt-6 space-y-3">
          {state.ledger.map((b, i) => (
            <div key={b.index} className="anim-in rounded-2xl bg-surface2 p-4 text-sm" style={delay(i / 2)}>
              <div className="flex justify-between gap-3"><span>{LEDGER_ICON[b.type] ?? "•"} {b.detail}</span><span className="shrink-0 text-xs text-muted">{ago(b.ts)}</span></div>
              <details className="mt-1.5"><summary className="cursor-pointer text-[11px] text-muted">Technical details</summary>
                <div className="mt-1 break-all font-mono text-[11px] text-muted">#{b.index} {b.type} · hash {b.hash.slice(0, 24)}… ← prev {b.prev.slice(0, 16)}…{b.fingerprint && <> · fingerprint {b.fingerprint.slice(0, 16)}…</>}</div></details>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3 className="text-lg font-semibold">Connected devices</h3>
        {state.devices.length === 0 && <p className="mt-4 text-muted">None yet.</p>}
        <div className="mt-4 divide-y divide-line">
          {state.devices.map((d) => (
            <div key={d.deviceId} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span><span className={d.online ? "text-ok" : "text-muted"}>●</span> <b>@{d.user}</b> <span className="text-muted">on {d.label}</span></span>
              <span className="text-xs text-muted">{d.online ? d.page : `last seen ${ago(d.seen)}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Admin */
function Admin({ state, say, refresh }: { state: State; say: Say; refresh: () => void }) {
  const me = state.me;
  const [pct, setPct] = useState<Record<string, number>>({});
  const act = async (action: string, extra: Record<string, unknown> = {}) => { const r = await post("/api/act", { actor: me.name, action, ...extra }); if (!r.ok) say(r.data.error); refresh(); };
  const disputes = state.loans.filter((l) => l.status === "disputed");
  return (
    <div className="space-y-8">
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div><h3 className="text-lg font-semibold">Emergency pause</h3><p className="mt-1 text-sm text-muted">Freezes listing, borrowing, handovers and alerts for everyone except admins.</p></div>
        <button className={`btn ${state.paused ? "btn-primary" : "btn-ghost"}`} onClick={() => act("pause")}>{state.paused ? "▶ Resume" : "⏸ Pause everything"}</button>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold">Members</h3>
        <div className="mt-4 divide-y divide-line">
          {state.users.map((u) => (
            <div key={u.name} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span><b>@{u.name}</b> <span className={`chip ml-1 !py-0 ${u.status === "verified" ? "bg-ok-soft text-ok" : u.status === "pending" ? "bg-warn-soft text-warn" : "bg-warn-soft text-danger"}`}>{u.role === "admin" ? "admin" : u.status}</span> <span className="text-xs text-muted">{u.credits} credits · trust {u.score}</span></span>
              {u.role !== "admin" && <span className="flex gap-2">
                {u.status === "pending" && <button className="btn btn-primary !py-1.5" onClick={() => act("verify", { target: u.name })}>Verify on-chain</button>}
                <button className="btn btn-ghost !py-1.5" onClick={() => act("blacklist", { target: u.name })}>{u.status === "blacklisted" ? "Unblock" : "Blacklist"}</button>
              </span>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Verifying a member gives them 100 starting credits. This stops fake accounts from borrowing.</p>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold">Disputes</h3>
        {disputes.length === 0 ? <p className="mt-3 text-sm text-muted">No open disputes.</p> : disputes.map((l) => (
          <div key={l.id} className="mt-4 space-y-3 rounded-2xl bg-surface2 p-4 text-sm">
            <div><b>{l.itemTitle}</b>: @{l.disputeBy} says “{l.disputeReason}” (borrower @{l.borrower}, owner @{l.owner}, deposit {l.deposit})</div>
            <div className="flex flex-wrap items-center gap-3"><span>Share of deposit back to borrower:</span>
              <select className="input !w-auto" value={pct[l.id] ?? 50} onChange={(e) => setPct({ ...pct, [l.id]: Number(e.target.value) })}>{[0, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}%</option>)}</select>
              <button className="btn btn-primary !py-1.5" onClick={() => act("resolve", { loanId: l.id, pct: pct[l.id] ?? 50 })}>Settle</button></div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold">Tamper demo</h3>
        <p className="mt-1 text-sm text-muted">Edits an item behind the ledger’s back, like someone changing the database. The item turns red with TAMPERED. Press again to undo.</p>
        <div className="mt-4 flex flex-wrap gap-2">{state.items.length === 0 ? <span className="text-sm text-muted">No items yet.</span> : state.items.map((it) => <button key={it.id} className="btn btn-ghost !py-1.5" onClick={() => act("tamper", { itemId: it.id })}>✎ {it.title}</button>)}</div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold">Security log</h3>
        <div className="mt-4 space-y-2 text-sm">
          {state.security.map((e, i) => (
            <div key={i} className="flex justify-between gap-3 rounded-xl bg-surface2 px-3 py-2"><span><span className={`font-mono text-xs ${e.type === "BLOCKED" || e.type === "TAMPER_DEMO" ? "text-danger" : "text-muted"}`}>{e.type}</span> @{e.actor}: {e.detail}</span><span className="shrink-0 text-xs text-muted">{ago(e.ts)}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Help */
const STEPS: { dev: "A" | "B" | "A+B"; title: string; body: string }[] = [
  { dev: "A", title: "Sign in as the admin", body: "On the PC open the app, choose Create an account and register the name admin first (the name admin is the administrator). Open a second browser tab and register alice (she owns the generator). Each tab is its own session, like its own device." },
  { dev: "B", title: "Join from your phone", body: "On the phone (same Wi-Fi) open http://<PC address>:3000 and register as carol. The PC’s Activity tab lists the phone under Connected devices within seconds." },
  { dev: "A", title: "Verify the members", body: "In the admin tab open Admin → Members and press Verify on alice and carol. Each gets 100 credits. Until then they can’t list or borrow." },
  { dev: "A", title: "List the generator", body: "As alice: Items → List an item. Title Portable generator, condition 4, deposit 30, add a photo. The card shows ✔ Integrity verified." },
  { dev: "B", title: "Ask to borrow", body: "On the phone (carol) tap Borrow for 24h on the generator. Alice sees the request in My loans within a couple of seconds." },
  { dev: "A", title: "Approve", body: "As alice: My loans → Approve." },
  { dev: "B", title: "Show the handover QR", body: "On the phone: My loans → My QR. A code appears and works for 10 minutes." },
  { dev: "A", title: "Scan and hand over", body: "As alice: My loans → Scan a QR code. Point the PC webcam at the phone, or take a photo of the phone screen, or paste the link. Pick the condition and confirm. Carol’s 30-credit deposit is held." },
  { dev: "B", title: "Return it", body: "On the phone tap Start return and show the return QR. Alice scans it, sets the condition and rates Carol’s care, then confirms. The deposit comes back and Carol’s trust score rises." },
  { dev: "A+B", title: "Try three attacks that fail", body: "1) Register bob and don’t verify him, and try to borrow: “Not verified”. 2) Change one character of a pasted QR link: “QR signature invalid”. 3) In Admin → Tamper demo, edit the generator: it turns red with TAMPERED. All blocked attempts appear in the security log." },
];
const DEV_STYLE = { A: "bg-accent-soft text-accent-ink", B: "bg-ok-soft text-ok", "A+B": "bg-warn-soft text-warn" } as const;
const DEV_NAME = { A: "Device A · PC", B: "Device B · Phone", "A+B": "Both devices" } as const;

function Help({ setTab }: { setTab: (t: Tab) => void }) {
  return (
    <div className="space-y-10">
      <div className="card">
        <h2 className="text-xl font-semibold tracking-tight">Demo: a generator during a flood</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">You need a PC (Device A) and a phone or second computer (Device B), both on the <b className="text-ink">same Wi-Fi</b>, or both using the deployed link. No second device? Use a second browser tab: every tab acts as its own device.</p>
        <button className="btn btn-ghost mt-5" onClick={() => setTab("items")}>Start now →</button>
      </div>
      <ol className="space-y-6">
        {STEPS.map((s, i) => (
          <li key={i} className="card anim-in flex gap-5" style={delay(i / 1.5)}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-white">{i + 1}</span>
            <div><span className={`chip ${DEV_STYLE[s.dev]}`}>{DEV_NAME[s.dev]}</span><h3 className="mt-3 font-semibold">{s.title}</h3><p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p></div>
          </li>
        ))}
      </ol>
      <div className="card">
        <h2 className="text-lg font-semibold">Common questions</h2>
        <div className="mt-5 divide-y divide-line">
          {[
            ["The QR page won’t load on my phone.", "Check the phone is on the same Wi-Fi as the PC and allow Node.js through the Windows firewall. The QR uses the PC’s Wi-Fi address automatically when you are on localhost."],
            ["The in-app camera says it is blocked.", "Browsers only allow the camera on https or localhost. Use the phone’s normal camera app to scan (it opens the link), or use “photo of the QR” or paste the link."],
            ["Is the ledger a real blockchain?", "Here it is a hash-chained log on the server. The same rules are written in contracts/contracts/SafeShare.sol, which you can deploy and test in Remix."],
            ["Is my data kept?", "Locally, yes (the data folder). On a free cloud host it resets when the app sleeps or redeploys."],
          ].map(([q, a]) => (
            <details key={q} className="group py-4"><summary className="cursor-pointer list-none text-sm font-medium transition hover:text-accent-ink">{q}</summary><p className="anim-fade mt-2 text-sm leading-relaxed text-muted">{a}</p></details>
          ))}
        </div>
      </div>
    </div>
  );
}
