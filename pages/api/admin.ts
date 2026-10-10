import { requireAdmin, HttpError } from "@/lib/auth";
import { route } from "@/lib/api";
import { db } from "@/lib/firebase";
import { ServerValue } from "firebase-admin/database";
import { ArticleSite, normUrl } from "@/lib/chain";

const idRe = /^[\w-]{1,64}$/;

function httpsUrl(v: any, field: string): string {
  const s = String(v || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(s)) throw new HttpError(400, `${field} must be an https URL`);
  return s;
}
function posInt(v: any, field: string, max = 1e9, min = 0): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Invalid ${field}`);
  return n;
}

/** আর্টিকেল সাইটের ফর্ম যাচাই: ২–১০টা https URL, সব একই ডোমেইনের, কোনোটা দুইবার নয় */
function parseSite(b: any): ArticleSite {
  const raw: string[] = Array.isArray(b.urls) ? b.urls : String(b.urls || "").split(/\r?\n/);
  const urls = raw.map((s) => String(s).trim()).filter(Boolean);
  if (urls.length < 2 || urls.length > 10) throw new HttpError(400, "২ থেকে ১০টা আর্টিকেল URL দিন (প্রতি লাইনে একটা)");
  const norms: string[] = [];
  for (const u of urls) {
    httpsUrl(u, "article url");
    const n = normUrl(u);
    if (!n) throw new HttpError(400, `URL ঠিক নয়: ${u}`);
    norms.push(n);
  }
  if (new Set(norms.map((n) => n.split("/")[0])).size !== 1) {
    throw new HttpError(400, "সব আর্টিকেল একই সাইটের (একই ডোমেইনের) হতে হবে");
  }
  if (new Set(norms).size !== norms.length) throw new HttpError(400, "একই URL দুইবার দেওয়া যাবে না");
  const name = String(b.name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60);
  if (!name) throw new HttpError(400, "সাইটের নাম দিন");
  return {
    name,
    urls,
    reward: posInt(b.reward, "reward", 1e7, 1),
    cooldown_minutes: posInt(b.cooldown_minutes, "cooldown_minutes", 60 * 24 * 30),
    dwell_seconds: posInt(b.dwell_seconds ?? 15, "dwell_seconds", 300, 5),
    is_active: b.is_active !== false,
  };
}

/** সব admin কাজ এক endpoint-এ: body.action দিয়ে আলাদা */
export default route(async (req, res) => {
  requireAdmin(req);
  const b = req.body || {};
  const action = String(b.action || "");

  switch (action) {
    case "list": {
      const [s, t, w] = await Promise.all([
        db().ref("article_sites").get(),
        db().ref("tasks").get(),
        db().ref("withdrawals").orderByKey().limitToLast(100).get(),
      ]);
      const sites = Object.entries((s.val() || {}) as Record<string, any>).map(([id, v]) => ({ id, ...v }));
      const tasks = Object.entries((t.val() || {}) as Record<string, any>).map(([id, v]) => ({ id, ...v }));
      const withdrawals: any[] = [];
      w.forEach((c) => {
        withdrawals.push({ id: c.key, ...c.val() });
      });
      withdrawals.reverse(); // নতুন আগে
      return void res.json({ success: true, sites, tasks, withdrawals });
    }

    case "saveSite": {
      const data = parseSite(b);
      let id = String(b.siteId || "");
      if (id && !idRe.test(id)) throw new HttpError(400, "Invalid siteId");
      if (!id) id = db().ref("article_sites").push().key!;
      await db().ref(`article_sites/${id}`).set(data);
      return void res.json({ success: true, siteId: id });
    }

    case "toggleSite": {
      const id = String(b.siteId || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid siteId");
      await db().ref(`article_sites/${id}/is_active`).set(!!b.active);
      return void res.json({ success: true });
    }

    case "deleteSite": {
      const id = String(b.siteId || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid siteId");
      await db().ref(`article_sites/${id}`).remove();
      return void res.json({ success: true });
    }

    case "payWithdrawal":
    case "rejectWithdrawal": {
      const id = String(b.id || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      const next = action === "payWithdrawal" ? "paid" : "rejected";
      const note = String(b.note || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);

      // pending থেকে একবারই বদলানো যায় (দুইবার pay/refund আটকায়)
      let rec: any = null;
      await db()
        .ref(`withdrawals/${id}`)
        .transaction((w: any) => {
          rec = null;
          if (w === null) return w;
          if (w.status !== "pending") return;
          w.status = next;
          w.handled_at = Date.now();
          w.note = note;
          rec = { ...w };
          return w;
        });
      if (!rec) throw new HttpError(409, "not_pending");

      const upd: Record<string, any> = { [`users/${rec.uid}/withdrawals/${id}/status`]: next };
      if (next === "rejected") upd[`users/${rec.uid}/balance`] = ServerValue.increment(Number(rec.amount));
      await db().ref().update(upd);
      return void res.json({ success: true });
    }

    case "saveTask": {
      const type = String(b.type || "");
      const base = {
        type,
        title: String(b.title || "").slice(0, 80),
        reward: posInt(b.reward, "reward"),
        one_time: true,
      };
      if (!base.title) throw new HttpError(400, "Title required");

      let data: Record<string, any>;
      if (type === "telegram_join") {
        const ch = String(b.channel_id || "").trim();
        if (!/^@[A-Za-z0-9_]{4,}$/.test(ch) && !/^-100\d+$/.test(ch)) {
          throw new HttpError(400, "channel_id must be @username or -100…");
        }
        data = { ...base, channel_id: ch, url: b.url ? httpsUrl(b.url, "url") : null };
      } else if (type === "timer_visit") {
        data = {
          ...base,
          url: httpsUrl(b.url, "url"),
          min_wait_seconds: posInt(b.min_wait_seconds || 10, "min_wait_seconds", 300),
        };
      } else {
        throw new HttpError(400, "Unknown task type");
      }

      const id = b.id ? String(b.id) : db().ref("tasks").push().key!;
      if (!idRe.test(id)) throw new HttpError(400, "Invalid id");
      await db().ref(`tasks/${id}`).set(data);
      return void res.json({ success: true, id });
    }

    case "deleteTask": {
      const id = String(b.taskId || "");
      if (!idRe.test(id)) throw new HttpError(400, "Invalid taskId");
      await db().ref(`tasks/${id}`).remove();
      return void res.json({ success: true });
    }

    default:
      throw new HttpError(400, "Unknown action");
  }
});
