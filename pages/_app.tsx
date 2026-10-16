import type { AppProps } from "next/app";
import Head from "next/head";
import Script from "next/script";
import { useEffect } from "react";
import "@/styles/globals.css";
import { applyTheme } from "@/lib/theme";
import { BRAND, LOGO_SOURCES } from "@/lib/brand";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    applyTheme();
    try { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); } catch {}
  }, []);
  return (
    <>
      <Head>
        <title>{BRAND}</title>
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('tfuel_theme');if(t==='dark')document.documentElement.dataset.theme='dark'}catch(e){}" }} />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="theme-color" content="#F4F6FB" />
        <link rel="preload" as="image" href={LOGO_SOURCES[0]} />
        <link rel="icon" href={LOGO_SOURCES[1]} />
        <link rel="apple-touch-icon" href={LOGO_SOURCES[1]} />
      </Head>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <Component {...pageProps} />
    </>
  );
}
