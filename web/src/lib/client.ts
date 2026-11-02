export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows PC" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

export const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
export const inTime = (t: number) => { const s = Math.round((t - Date.now()) / 1000); if (s <= 0) return "overdue"; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m left` : `${Math.round(s / 3600)}h left`; };

// Shrinks a phone photo to a small JPEG data URL before upload.
export function resizeImage(file: File, max = 800): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Could not read that image")); };
    img.src = url;
  });
}

// fetch() that proves who you are: the session token lives in this browser tab only.
export function authFetch(url: string, init: RequestInit = {}) {
  let t = "";
  try { t = sessionStorage.getItem("ss-token") || ""; } catch { /* ignore */ }
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "x-session": t } });
}
