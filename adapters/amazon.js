// amazon.js — collect via KanBkam (seller=1, Amazon.sa) instead of the deals page (renders only when visible).
// check runs on https://www.amazon.sa: product page HTML, buy button + #availability + priceAmount.
(function(){
  const S = window.SAYDA;
  const asinOf = u => (String(u).match(/\/dp\/([A-Z0-9]{10})/) || [])[1];
  S.adapters.amazon = {
    collect: null,
    // row-by-row (never the shared pool): Amazon throttles concurrent product fetches into a hang.
    async check(rows) {
      return S.eachRow(rows, async (r, signal) => {
        const { status, text } = await S.fetchText('/dp/' + asinOf(r.url) + '?language=ar_AE&psc=1', { signal });
        const d = S.dom(text); const btn = !!(d.querySelector('#add-to-cart-button') || d.querySelector('#buy-now-button'));
        const av = S.text(d.querySelector('#availability')).split('{')[0].trim();
        const pm = text.match(/"priceAmount"\s*:\s*([\d.]+)/);
        const captcha = !btn && /Enter the characters|أدخل الأحرف/i.test(text);
        const low = av.match(/تبقى (\d+)/);
        return { id: r.id, found: status === 200 && !captcha, captcha, live: pm ? +pm[1] : null, buyable: btn, stock: low ? +low[1] : (btn ? 99 : 0), note: av.slice(0, 40) };
      }, S.rowTimeout, 900);
    },
    async coupons() {
      const { text } = await S.fetchText('/-/ar/');
      return { hits: [...text.matchAll(/.{0,50}(كود|كوبون|بطاقات (?:الراجحي|الأهلي|الإنماء|البلاد|ساب|مدى)|خصم إضافي).{0,80}/g)].map(m => m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).slice(0, 12) };
    }
  };
})();
