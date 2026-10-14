/*
 * Article-chain script — প্রতিটা আর্টিকেল পেজে (বা Blogger theme-এ একবার) বসান:
 *   <script src="https://YOUR-APP/chain.js" async></script>
 * কোনো ?r= না থাকলে (সাধারণ পাঠক) এটা কিছুই করে না।
 */
(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var API = script.src.replace(/chain\.js(\?.*)?$/, '') + 'api/chain-step';

  var q = new URLSearchParams(location.search);
  var r = q.get('r');
  try {
    if (r && /^[a-f0-9]{32}$/.test(r)) sessionStorage.setItem('tma_r', r);
    else r = sessionStorage.getItem('tma_r');
  } catch (e) {}
  if (!r || !/^[a-f0-9]{32}$/.test(r)) return;

  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#111;color:#fff;' +
    'font:16px/1.4 system-ui,sans-serif;padding:12px 16px;text-align:center;box-shadow:0 -2px 10px #0006';
  var btn = document.createElement('button');
  btn.style.cssText = 'margin-left:10px;padding:9px 16px;border:0;border-radius:8px;background:#f5a623;color:#000;font-weight:700;font-size:16px;cursor:pointer';
  var msg = document.createElement('span');

  function show(text, withBtn, label, onclick) {
    msg.textContent = text;
    box.innerHTML = '';
    box.appendChild(msg);
    if (withBtn) { btn.textContent = label; btn.disabled = false; btn.onclick = onclick; box.appendChild(btn); }
  }
  function mount() { if (!box.parentNode) document.body.appendChild(box); }

  function call(action) {
    // text/plain রাখা হয়েছে যাতে browser-এর preflight লাগে না
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ r: r, url: location.href, action: action, scrolled: scrolled }) }).then(function (x) { return x.json(); });
  }

  // পাঠককে নিচ পর্যন্ত scroll করতে হবে (সময় পার + scroll শেষ — দুটোই লাগে)
  var scrolled = false, timeDone = false, cur = null;
  function atBottom() {
    var d = document.documentElement, b = document.body;
    var h = Math.max(d.scrollHeight, b ? b.scrollHeight : 0);
    var y = window.pageYOffset || d.scrollTop || 0;
    return window.innerHeight + y >= h - 180;
  }
  function onScroll() {
    if (scrolled) return;
    if (atBottom()) {
      scrolled = true;
      window.removeEventListener('scroll', onScroll);
      if (timeDone && cur) ready(cur.step, cur.total);
    }
  }
  function watchScroll() {
    if (document.body) document.body.style.paddingBottom = '90px'; // নিচের বার যেন লেখা ঢেকে না দেয়
    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 300); // ছোট পেজ: scroll-এর দরকারই নেই
  }

  // শুরুর কয়েক সেকেন্ড scroll বন্ধ: পাঠক ওপরের অংশ পড়বেন
  var locked = false;
  function stop(e) { if (e.cancelable) e.preventDefault(); }
  function keyStop(e) {
    if ([32, 33, 34, 35, 36, 38, 40].indexOf(e.keyCode) >= 0) stop(e);
  }
  function toTop() { if ((window.pageYOffset || 0) > 0) window.scrollTo(0, 0); }
  function lockScroll(on) {
    if (on === locked) return;
    locked = on;
    var h = document.documentElement, b = document.body;
    if (on) {
      window.scrollTo(0, 0);
      h.style.overflow = 'hidden'; if (b) b.style.overflow = 'hidden';
      window.addEventListener('wheel', stop, { passive: false });
      window.addEventListener('touchmove', stop, { passive: false });
      window.addEventListener('keydown', keyStop, true);
      window.addEventListener('scroll', toTop);
    } else {
      h.style.overflow = ''; if (b) b.style.overflow = '';
      window.removeEventListener('wheel', stop, { passive: false });
      window.removeEventListener('touchmove', stop, { passive: false });
      window.removeEventListener('keydown', keyStop, true);
      window.removeEventListener('scroll', toTop);
    }
  }

  var timer = null;
  function countdown(sec, step, total, lock) {
    var left = sec;
    var lockLeft = Math.min(lock || 0, sec);
    cur = { step: step, total: total };
    timeDone = false;
    clearInterval(timer);
    lockScroll(lockLeft > 0);
    function tick() {
      if (left > 0) {
        if (lockLeft > 0) {
          show('Article ' + step + '/' + total + ' — read the top of the article. Scrolling unlocks in ' + lockLeft + 's', false);
          lockLeft--;
        } else {
          lockScroll(false);
          show('Article ' + step + '/' + total + ' — keep reading… ' + left + 's' + (scrolled ? '' : ' · scroll down to the end ⬇'), false);
        }
        left--;
      } else {
        clearInterval(timer);
        lockScroll(false);
        timeDone = true;
        if (scrolled) ready(step, total);
        else show('Article ' + step + '/' + total + ' — scroll down to the end of the article to continue ⬇', false);
      }
    }
    tick();
    timer = setInterval(tick, 1000);
  }

  function ready(step, total) {
    cur = { step: step, total: total };
    timeDone = true;
    if (!scrolled) { show('Article ' + step + '/' + total + ' — scroll down to the end of the article to continue ⬇', false); return; }
    var last = step === total;
    show('Article ' + step + '/' + total + ' complete', true, last ? 'Get my code' : 'Next article ➜', function () {
      btn.disabled = true;
      call('complete').then(function (d) {
        if (d.code) {
          box.innerHTML = '';
          var big = document.createElement('div');
          big.style.cssText = 'font-size:34px;font-weight:800;letter-spacing:6px;color:#ffd166';
          big.textContent = d.code;
          var s = document.createElement('div');
          s.textContent = 'Enter this code in the Mini App (valid for ' + d.code_ttl_min + ' minutes)';
          var cp = document.createElement('button');
          cp.textContent = 'Copy code';
          cp.style.cssText = 'margin:10px 0;padding:8px 18px;border:0;border-radius:10px;background:#ffd166;color:#1a1a1a;font-weight:700;font-size:14px;cursor:pointer';
          cp.onclick = function () {
            var done = function () { cp.textContent = 'Copied ✓'; setTimeout(function () { cp.textContent = 'Copy code'; }, 2000); };
            if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(d.code).then(done, fallback); } else { fallback(); }
            function fallback() {
              var t = document.createElement('textarea'); t.value = d.code; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
              try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(t);
            }
          };
          box.appendChild(big); box.appendChild(cp); box.appendChild(s);
        } else if (d.next_url) {
          location.href = d.next_url;
        } else if (d.error === 'too_early') {
          countdown(d.wait || 3, step, total);
        } else {
          show('Something went wrong. Please reload the page.', false);
        }
      }).catch(function () { show('Network problem. Please try again.', true, 'Retry', function () { ready(step, total); }); });
    });
  }

  function start() {
    call('arrive').then(function (d) {
      if (d.error === 'not_chain_page') return;              // এই পেজ চেইনের অংশ নয়
      mount();
      watchScroll();
      if (d.error === 'out_of_order') {
        show('Please read the articles in order. Start from article ' + d.need_step + '.', true, 'Go ➜', function () { location.href = d.go_url; });
      } else if (d.error === 'run_expired' || d.error === 'run_closed' || d.error === 'bad_run') {
        show('This session has expired. Please start the article site again from the Mini App.', false);
      } else if (d.error) {
        return;                                                // অন্য সাইট/নিষ্ক্রিয় ইত্যাদি: চুপ থাকি
      } else if (d.ready) {
        ready(d.step, d.total);
      } else {
        countdown(d.wait, d.step, d.total, d.lock);
      }
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
