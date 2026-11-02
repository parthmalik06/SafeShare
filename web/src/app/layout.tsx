import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SafeShare",
  description: "Lend and borrow emergency equipment with trust that cannot be quietly changed.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const themeScript = `try{if(localStorage.getItem('ss-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
