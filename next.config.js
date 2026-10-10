/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
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
