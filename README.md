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

## Admin প্যানেলে কী কী করবেন

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
