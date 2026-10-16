/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/(logo|usdt).png", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      {
        source: "/(.*)",
        headers: [
          // Telegram Mini App অবশ্যই iframe-এ চলে, তাই শুধু Telegram-কে অনুমতি
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https://web.telegram.org https://*.telegram.org;",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
