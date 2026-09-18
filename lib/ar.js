// Arabic date/number helpers used by build.js
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const DAYS = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const ORD = {1:'الواحد',2:'الاثنين',3:'الثلاثة',4:'الأربعة',5:'الخمسة',6:'الستة',7:'السبعة',8:'الثمانية',9:'التسعة',10:'العشرة',11:'الأحد عشر',12:'الاثني عشر',13:'الثلاثة عشر',14:'الأربعة عشر',15:'الخمسة عشر',16:'الستة عشر',17:'السبعة عشر',18:'الثمانية عشر',19:'التسعة عشر',20:'العشرين'};
const arNum = n => String(n).replace(/\d/g, d => AR_DIGITS[+d]);
function riyadh(iso){ // Date in Riyadh (UTC+3) as {y,m,d,dow,h,min}
  const d = new Date(iso); const t = new Date(d.getTime() + 3*3600e3);
  return { y:t.getUTCFullYear(), m:t.getUTCMonth(), d:t.getUTCDate(), dow:t.getUTCDay(), h:t.getUTCHours(), min:t.getUTCMinutes() };
}
function longDate(iso){ const r = riyadh(iso.length===10 ? iso+'T12:00:00+03:00' : iso); return `${DAYS[r.dow]} ${arNum(r.d)} ${MONTHS[r.m]} ${arNum(r.y)}`; }
function shortDate(iso){ const r = riyadh(iso.length===10 ? iso+'T12:00:00+03:00' : iso); return `${arNum(r.d)} ${MONTHS[r.m]} ${arNum(r.y)}`; }
function time12(iso){ const r = riyadh(iso); const h12 = r.h%12||12; const ap = r.h<12?'ص':'م'; return `${arNum(h12)}:${arNum(String(r.min).padStart(2,'0'))} ${ap}`; }
function countWord(n){ return ORD[n] || arNum(n); }
module.exports = { arNum, longDate, shortDate, time12, countWord, riyadh, MONTHS };
