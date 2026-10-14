# TMA Tap-to-Earn Game + Article Site (Next.js + Vercel + Firebase)

Telegram Mini App: Tap, **Article Site চেইন** (৫টা আর্টিকেল ক্রমে → প্রতিবার নতুন ৬ ডিজিটের কোড → reward), Telegram/Timer টাস্ক, Profile ও **Withdraw**, আর Admin প্যানেল।

## চালু করার ধাপ

1. **Telegram bot**: @BotFather → `/newbot` → `BOT_TOKEN` নিন।
2. **Firebase**: console.firebase.google.com → নতুন project → *Realtime Database* তৈরি → Rules-এ `database.rules.json`-এর লেখা বসিয়ে Publish (সব client access বন্ধ) → Project Settings → Service accounts → *Generate new private key* (JSON ফাইল)।
3. **Env**: `.env.example` কপি করে `.env.local` বানান (Vercel-এ Environment Variables-এ একই মান)।
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` → JSON ফাইল থেকে (`FIREBASE_PRIVATE_KEY` যেমন আছে তেমন, `\n` সহ)
   - `FIREBASE_DATABASE_URL` → Database পেজ থেকে
   - `SERVER_SECRET` → `openssl rand -hex 32`
   - `ADMIN_PASSWORD` → Admin ঢোকার পাসওয়ার্ড (কঠিন দিন)
   - `ADMIN_TELEGRAM_IDS` → (ঐচ্ছিক) আপনার Telegram numeric ID
4. **GitHub → Vercel**: repo-তে push → vercel.com → *Import Project* → Env বসিয়ে *Deploy*। লিংক: `https://নাম.vercel.app`
5. **Bot-এ Mini App**: BotFather → Bot Settings → Menu Button → URL = আপনার Vercel লিংক।
6. **Admin**: **ব্রাউজারে** `https://নাম.vercel.app/admin` খুলুন → `ADMIN_PASSWORD` দিয়ে ঢুকুন (১২ ঘণ্টা লগইন থাকে)। চাইলে `ADMIN_TELEGRAM_IDS` দিয়ে Telegram-এর ভেতর থেকেও ঢোকা যায়।
7. **Telegram join টাস্ক** দিলে bot-কে ওই চ্যানেলের **Administrator** বানান।

## Admin প্যানেল (v4 — Light UI)
সাইডবার: **Dashboard** · **Users** (খোঁজা, balance adjust — কারণ বাধ্যতামূলক, Ban) · **Article Sites** (started/finished/claimed) · **Tasks** · **Withdrawals** (ফিল্টার, সার্চ, নোট, CSV) · **Fraud monitor** · **Settings** (Maintenance, Announcement, tap/energy, withdraw চালু-বন্ধ, method যোগ/বাদ, নতুন ইউজারের অপেক্ষা, দৈনিক সীমা) · **Channel check** (bot admin কিনা + ইউজারের verify ব্যর্থতার আসল কারণ) · **Activity log**।

লোগো: `public/logo.png` রাখলে সেটাই সবখানে; না থাকলে `https://iili.io/nMRQttV.png`। নাম বদলাতে env `NEXT_PUBLIC_BRAND`।

## TFUEL ট্যাব (ধাপ ২)
Admin → **Market & Trading**: Trading master switch (ডিফল্টে বন্ধ), Buy/Sell আলাদা switch, coins per TFUEL, fee %, min/max/দৈনিক সীমা, price override, Deposit ও USDT payout নেটওয়ার্ক যোগ/বাদ। **USDT desk**: deposit-এর TxID chain-এ মিলিয়ে "Approve & credit"; payout নিজে পাঠিয়ে "Mark paid"। দাম আসে CoinGecko → Gate.io → Binance পর পর; ১০ মিনিটের পুরনো হলে trade নিজে থেকে বন্ধ। সার্ভারে কোনো wallet key নেই।

## ধাপ ৩ — Boost, Staking, Daily, Referral, লাইভ চার্ট
- সব মান user-কে **TFUEL + USDT মূল্য** (BDT নেই) হিসেবে দেখানো হয়। ভেতরে coin পূর্ণসংখ্যা; ১ TFUEL = `coins per TFUEL` (Market & Trading)।
- **TFUEL ট্যাব**: ১০ সেকেন্ডে লাইভ দাম, চার্টে 24H/7D/30D ও Line/Candles।
- Admin → **Rewards & Plans**: Daily reward (দিনভিত্তিক), Referral (বন্ধু প্রথম টাস্ক শেষ করলে bonus; Mini App লিংক `https://t.me/বট/অ্যাপ` বসান), Auto-mining সীমা, Boost প্ল্যান, Staking প্ল্যান (দিন, লাভ %, min/max, pool cap)।
- Staking/Boost শুধু অ্যাপের TFUEL দিয়ে; Staking লাভ নতুন তৈরি TFUEL, তাই % ও pool cap বাজেট দেখে দিন।

## (পুরনো) Admin প্যানেলে কী কী করবেন

**Article সাইট ট্যাব**
1. *নতুন Article সাইট* ফর্মে: সাইটের নাম, ৫টা আর্টিকেল URL (প্রতি লাইনে একটা, **১ম থেকে শেষ ক্রমে**, সব একই ডোমেইনের, https), reward, cooldown (মিনিট), প্রতি আর্টিকেলে অপেক্ষা (সেকেন্ড)।
2. *সাইট যোগ করুন* চাপুন।
3. পেজের ওপরের বক্সে থাকা `<script …chain.js…>` লাইনটা কপি করে ওই সাইটের প্রতিটা আর্টিকেলে বসান। **Blogger**: Theme → Edit HTML → `</body>`-এর আগে একবার। সব সাইটে একই লাইন।
4. ২০টা সাইট হলে একইভাবে ২০বার যোগ করুন। সার্ভার প্রতিবার cooldown-মুক্ত একটা সাইট random বাছে।
- এডিট / বন্ধ-চালু / মুছুন বাটন প্রতিটা সাইটের নিচে।

**Withdraw ট্যাব**
- ব্যবহারকারীর অনুরোধ এখানে আসে (পরিমাণ, পদ্ধতি, অ্যাকাউন্ট নম্বর)। coin অনুরোধের সাথে সাথেই কাটা যায়।
- নিজে টাকা পাঠিয়ে **টাকা পাঠিয়েছি ✔** চাপুন। বাতিল করতে **বাতিল + ফেরত** (coin ফেরত যায়; দুইবার ফেরত হয় না)।

**Tasks ট্যাব**: Telegram চ্যানেল join ও টাইমার-লিংক টাস্ক যোগ/মুছুন।

## Withdraw সেটিং (ঐচ্ছিক env)
`MIN_WITHDRAW` (ডিফল্ট ১০০০০ coin), `WITHDRAW_METHODS` (কমা দিয়ে, ডিফল্ট `bKash,Nagad,Rocket,USDT (TRC20)`), `COINS_PER_UNIT` (১০০০), `UNIT_LABEL` (BDT), `RUN_TTL_MIN` (৬০), `CODE_TTL_MIN` (১০)।

## চেইন কীভাবে কাজ করে
1. Mini App → **Earn → Article Site** → সার্ভার একটা run বানায়, ১ম আর্টিকেলের লিংক দেয় (গোপন `?r=` টোকেন সহ)।
2. প্রতিটা আর্টিকেলে `chain.js` সার্ভারকে জিজ্ঞেস করে "ক্রম ঠিক?" → টাইমার → *পরের আর্টিকেল*।
3. **সরাসরি শেষ আর্টিকেলে** গেলে সার্ভার কোড দেয় না, ঠিক আর্টিকেলে ফেরত পাঠায়।
4. শেষ আর্টিকেলে প্রতিবার **নতুন random ৬ ডিজিটের কোড** (DB-তে শুধু HMAC hash)। ১০ মিনিট বৈধ, ৩ বার ভুলে run বাতিল, একই কোড দুইবার চলে না।
5. কোড Mini App-এ বসালে reward; ওই সাইটের cooldown শুরু।

## নিরাপত্তা
- `userId` কখনো client থেকে নেওয়া হয় না; signed `initData` সার্ভারে যাচাই। টাকা-সংক্রান্ত endpoint-এ initData ১ ঘণ্টার মধ্যের।
- Tap-এর সময় সার্ভার মাপে (সর্বোচ্চ ৫০/batch, ১৫/sec, energy-র বেশি নয়)।
- ভুল কোডের গণনা commit হয়; claim/withdraw/refund সব transaction-এ, তাই একসাথে দুইবার চাপলে দুইবার হয় না।
- আর্টিকেল সাইট থেকে আসা অনুরোধে `Origin` মেলানো হয়। দক্ষ কেউ স্ক্রিপ্ট দিয়ে ক্রম+সময় মেনে চেইন চালাতে পারে, তাই reward ও cooldown এমন রাখুন যাতে বট চালিয়ে লাভ না হয়।
- `rate_limits` ডেটা ধীরে জমে; মাঝে মাঝে Firebase থেকে মুছে দিতে পারেন।

## v5
- Energy: প্রতি tap-এ `energy_cost` (ডিফল্ট 1.5), খালি হলে `empty_refill_hours` (ডিফল্ট 3) ঘণ্টা পর পুরো refill। Admin → Settings → Game থেকে বদলানো যায়; `Slow regen` = 0 রাখুন।
- Profile = exchanger-style wallet (TFUEL + USDT, কোথা থেকে পেল, recent activity) — API: `/api/wallet`।
- Logo ছোট করা হয়েছে।

## v6 (Engagement)
- Lucky Spin, Leaderboard (দৈনিক/সাপ্তাহিক/সর্বকালের + সাপ্তাহিক prize), Promo code, Rewarded ads (Adsgram), Price alerts, Limit orders (auto buy/sell), পূর্ণ History, Portfolio chart, Telegram bot notification, chart zoom/pan।
- সব Admin → **Engagement** ট্যাব থেকে নিয়ন্ত্রণ।
- Vercel Environment Variables-এ যোগ করুন: `CRON_SECRET` (আবশ্যক alert/order/বার্তার জন্য), `ADS_SECRET` (ঐচ্ছিক)।
- cron-job.org (ফ্রি) এ `https://YOUR-SITE/api/cron?key=CRON_SECRET` প্রতি ১–৫ মিনিটে চালান। (vercel.json-এ দিনে একবারের backup cron আছে।)

## Binance auto-approve deposits (v8)
1. Binance → API Management → create a key with **only "Enable Reading"** (no trading, withdrawals or transfers; keys with those are rejected).
2. Admin → Market & Trading → *Binance auto-approve*: paste key + secret (stored encrypted), then for each deposit network set the **Binance network code** (TRX, BSC, ETH…) and use your **Binance deposit address**.
3. Turn the switch on, set the auto limit, press *Save changes*.
Users get an exact amount (e.g. 50.37 USDT); only a deposit with that amount, address, network and TxID is credited. Larger or mismatched deposits stay in the USDT desk for you.
