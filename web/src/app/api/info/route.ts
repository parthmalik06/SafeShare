import { NextResponse } from "next/server";
import os from "node:os";

const VIRTUAL = /(vethernet|wsl|virtualbox|vmware|vbox|docker|hyper-v|tailscale|zerotier|hamachi|tun|tap|utun|bridge|br-|veth|vpn)/i;
const PRIV172 = /^172\.(1[6-9]|2\d|3[01])\./;

// Network addresses of this machine, best guess for "the Wi-Fi a phone can reach" first.
export async function GET() {
  const found: { name: string; address: string; score: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      const a = i.address;
      if (i.family !== "IPv4" || i.internal || a.startsWith("169.254.")) continue;
      let score = 0;
      if (/^192\.168\./.test(a) || /^10\./.test(a)) score += 2;
      if (/wi-?fi|wlan|wireless|^wl|^en0$/i.test(name)) score += 4;
      else if (/ethernet|^eth|^en\d/i.test(name)) score += 2;
      if (VIRTUAL.test(name)) score -= 6;
      if (PRIV172.test(a)) score -= 1;
      found.push({ name, address: a, score });
    }
  }
  found.sort((x, y) => y.score - x.score);
  return NextResponse.json({ lan: found.map((f) => f.address), nets: found.map(({ name, address }) => ({ name, address })) });
}
