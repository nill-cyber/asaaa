import type { AppProps } from "next/app";
import Head from "next/head";
import Script from "next/script";
import "@/styles/globals.css";
import { BRAND, LOGO_SOURCES } from "@/lib/brand";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>{BRAND}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="theme-color" content="#F4F6FB" />
        <link rel="icon" href={LOGO_SOURCES[1]} />
        <link rel="apple-touch-icon" href={LOGO_SOURCES[1]} />
      </Head>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <Component {...pageProps} />
    </>
  );
}
