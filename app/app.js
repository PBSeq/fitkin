// fitkin v0.2 — Firestore 연동 + QR 킨코드. 인증은 v0.3(스토어 출시 전) 업그레이드.
// 프라이버시 원칙: 연락처·정밀좌표는 서버에 절대 저장하지 않는다. 동네는 이용자가 적은 텍스트만.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, limit }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp({
  projectId: "fitkin-buddy",
  appId: "1:125721622489:web:48a3852bf46911ab0e4bc8",
  apiKey: "AIzaSyB8Res951FCInN0N3ME2K_PyfDVfXUKAXM",
  authDomain: "fitkin-buddy.firebaseapp.com",
});
const db = getFirestore(app);
const $ = q => document.querySelector(q);
const st = () => JSON.parse(localStorage.getItem("fitkin") || "{}");
const put = s => localStorage.setItem("fitkin", JSON.stringify(s));
const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

// ── 프로필 발행 ──
window.fitkinPublish = async function () {
  const s = st();
  if (!s.name || !s.hood) return;
  if (!s.id) { s.id = rand(12); s.editKey = rand(24); put(s); }
  await setDoc(doc(db, "profiles", s.id), {
    name: s.name.slice(0, 30), sports: s.sports, vibe: s.vibe, days: s.days,
    hood: s.hood.trim().toLowerCase().slice(0, 40), editKey: s.editKey, ts: Date.now(),
  });
  s.published = Date.now(); put(s);
  paintHome();
};

// ── 동네 카운트 (정직한 실측 — 부풀리지 않는다) ──
async function hoodCount(hood) {
  const qs = await getDocs(query(collection(db, "profiles"), where("hood", "==", hood), limit(50)));
  return qs.size;
}

// ── QR 킨코드 ──
function kinUrl(id) { return location.origin + location.pathname + "#kin=" + id; }
window.fitkinDrawQR = function () {
  const s = st(); if (!s.id) return;
  const box = $("#qrCanvas"); if (!box || !window.qrcode) return;
  const q = qrcode(0, "M"); q.addData(kinUrl(s.id)); q.make();
  box.innerHTML = q.createSvgTag({ cellSize: 3, margin: 2 });
  const svg = box.querySelector("svg");
  svg.style.width = "100%"; svg.style.height = "100%"; svg.style.borderRadius = "12px";
};

// ── 스캔/링크 수신: #kin=<id> 로 들어오면 킨 맺기 ──
async function handleKinLink() {
  const m = location.hash.match(/#kin=([a-z0-9]+)/);
  if (!m) return;
  const other = m[1]; const s = st();
  history.replaceState(null, "", location.pathname);
  if (!s.id) { s.pendingKin = other; put(s); return; }   // 온보딩 후 자동 연결
  if (other === s.id) return;
  const them = await getDoc(doc(db, "profiles", other));
  if (!them.exists()) { toast("that kin code doesn't exist (yet)"); return; }
  const linkId = [s.id, other].sort().join("_");
  await setDoc(doc(db, "links", linkId), { a: s.id, b: other, ts: Date.now() });
  toast("you're kin with " + (them.data().name || "someone") + " 🎉");
  paintKin();
}

// ── 킨 목록 ──
async function myKin() {
  const s = st(); if (!s.id) return [];
  const [qa, qb] = await Promise.all([
    getDocs(query(collection(db, "links"), where("a", "==", s.id), limit(50))),
    getDocs(query(collection(db, "links"), where("b", "==", s.id), limit(50)))]);
  const ids = new Set();
  qa.forEach(d => ids.add(d.data().b)); qb.forEach(d => ids.add(d.data().a));
  const out = [];
  for (const id of ids) {
    const p = await getDoc(doc(db, "profiles", id));
    if (p.exists()) out.push(p.data());
  }
  return out;
}

async function paintKin() {
  const wrap = $("#kinList"); if (!wrap) return;
  const kin = await myKin();
  wrap.innerHTML = kin.length
    ? kin.map(k => `<div class="kinrow"><span class="kava">${["🏃","🎾","🏋️","🏊"][k.name.length % 4]}</span>
        <div><b>${k.name}</b><p>${(k.sports || []).slice(0, 3).join(" · ")} · ${k.hood}</p></div></div>`).join("")
    : `<p class="dimtext">no kin yet — show your code to someone at the gym.</p>`;
}

async function paintHome() {
  const s = st(); if (!s.done) return;
  window.fitkinDrawQR();
  paintKin();
  if (s.published && s.hood) {
    const n = await hoodCount(s.hood.trim().toLowerCase());
    const el = $("#hCount");
    if (el) el.textContent = n <= 1 ? "first in your hood. legend." : n + " in your hood already";
  }
  if (s.pendingKin) { const p = s.pendingKin; delete s.pendingKin; put(s); location.hash = "#kin=" + p; handleKinLink(); }
}

function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.className = "show";
  setTimeout(() => t.className = "", 3200);
}

window.fitkinHome = paintHome;
handleKinLink();
if (st().done) paintHome();
