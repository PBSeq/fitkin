// fitkin v1.1 — 익명인증(uid) + ZIP 매칭·추천 + 킨 메시지.
// 프라이버시 원칙 유지: GPS 없음. 이용자가 적는 5자리 ZIP 만.
// "근처" = ZIP 앞 3자리(우편 권역) 일치 — 지도 데이터 $0.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
         browserPopupRedirectResolver, signInAnonymously, onAuthStateChanged,
         signInWithCredential, GoogleAuthProvider, OAuthProvider }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where,
         orderBy, limit, limitToLast, addDoc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp({
  projectId: "fitkin-buddy",
  appId: "1:125721622489:web:48a3852bf46911ab0e4bc8",
  apiKey: "AIzaSyB8Res951FCInN0N3ME2K_PyfDVfXUKAXM",
  authDomain: "fitkin-buddy.firebaseapp.com",
});
const db = getFirestore(app);
// Capacitor WKWebView 에서 getAuth() 기본 리졸버가 굳는다 — 리졸버 없이 초기화(공식 패턴).
// 팝업 로그인은 호출 시에만 리졸버를 명시적으로 넘긴다.
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
const $ = q => document.querySelector(q);
const st = () => JSON.parse(localStorage.getItem("fitkin") || "{}");
const put = s => localStorage.setItem("fitkin", JSON.stringify(s));

let UID = null;
// 익명 로그인은 "복원된 유저가 없을 때만". 무조건 호출하면 구글/애플로
// 로그인한 세션이 재실행 때마다 새 익명 계정으로 갈아엎어진다.
const authP = new Promise(res => {
  let booted = false;
  onAuthStateChanged(auth, u => {
    if (u) { UID = u.uid; res(u.uid); }
    else if (!booted) signInAnonymously(auth).catch(() => {});
    booted = true;
  });
});
// 오프라인/인증 실패 시 무한 대기 금지 — 8초 내 미해결이면 null 로 진행
const ready = Promise.race([authP, new Promise(r => setTimeout(() => r(null), 8000))]);

// XSS 방어: 모든 유저 입력 필드는 이스케이프 후에만 innerHTML 에 들어간다
const esc = v => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── 소셜 로그인 — 네이티브(iOS)는 SocialLogin 플러그인→signInWithCredential,
//    웹은 signInWithPopup. 애플 심사규정 4.8: 구글을 켜면 애플 로그인도 의무.
const GOOGLE_IOS_CLIENT_ID =
  "125721622489-cvj308ao2l8v2dhopj2rjh1g38crft1f.apps.googleusercontent.com";
// 익명 세션에 자격증명을 "링크"해 UID 를 보존한다 — 이미 발행한 카드·킨·채팅이
// 로그인 후에도 그대로 남는다. 그 자격증명이 딴 계정에 묶여 있을 때만 signIn 폴백.
async function credLogin(c) {
  await ready;
  try {
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      const { linkWithCredential } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      return await linkWithCredential(auth.currentUser, c);
    }
  } catch (e) {
    if (!String(e.code).includes("credential-already-in-use") &&
        !String(e.code).includes("provider-already-linked")) throw e;
  }
  return signInWithCredential(auth, c);
}
window.fitkinLogin = async function (kind) {
  try {
    let cred;
    const SL = window.Capacitor && window.Capacitor.isNativePlatform &&
               window.Capacitor.isNativePlatform() &&
               window.Capacitor.Plugins && window.Capacitor.Plugins.SocialLogin;
    if (SL) {
      await SL.initialize({ google: { iOSClientId: GOOGLE_IOS_CLIENT_ID }, apple: {} });
      const opts = { scopes: kind === "google" ? ["email", "profile"] : ["email", "name"] };
      let rawNonce = null;
      if (kind === "apple" && window.crypto && crypto.subtle) {
        // 리플레이 방어: raw nonce 의 SHA-256 을 애플에, raw 를 Firebase 에.
        rawNonce = Array.from(crypto.getRandomValues(new Uint8Array(16)),
          b => b.toString(16).padStart(2, "0")).join("");
        const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawNonce));
        opts.nonce = Array.from(new Uint8Array(d),
          b => b.toString(16).padStart(2, "0")).join("");
      }
      const r = await SL.login({ provider: kind, options: opts });
      const idToken = r && r.result && r.result.idToken;
      if (!idToken) throw Object.assign(new Error("no idToken"), { code: "popup-closed" });
      const c = kind === "apple"
        ? new OAuthProvider("apple.com").credential(
            rawNonce ? { idToken, rawNonce } : { idToken })
        : GoogleAuthProvider.credential(idToken);
      cred = await credLogin(c);
    } else {
      const { signInWithPopup } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      const provider = kind === "apple" ? new OAuthProvider("apple.com") : new GoogleAuthProvider();
      cred = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    }
    const s = st(); s.loginName = cred.user.displayName || ""; put(s);
    toast("signed in" + (s.loginName ? " as " + s.loginName.split(" ")[0] : "") + " ✓");
    const row = $("#loginRow"); if (row) row.style.display = "none";
    const nameEl = $("#fName");
    if (nameEl && !nameEl.value && s.loginName) { nameEl.value = s.loginName.split(" ")[0]; nameEl.dispatchEvent(new Event("input")); }
  } catch (e) {
    if (String(e.code).includes("account-exists-with-different-credential"))
      toast("that email is already tied to your other sign-in — try the other button");
    else if (String(e.code).includes("operation-not-allowed"))
      toast("sign-in isn't available right now — guest mode works fine");
    else if (!String(e.code).includes("popup-closed") && !String(e.code).includes("canceled"))
      toast("login hiccup — guest mode works fine");
  }
};

// ── 프로필 발행 (uid 문서 — 본인만 쓰기, redo 는 같은 문서 갱신) ──
// UID 없이는 절대 쓰지 않는다 (profiles/null 방지). auth 회복 시 자동 재시도.
window.fitkinPublish = async function () {
  const s = st();
  if (!s.name || !/^[0-9]{5}$/.test(s.zip || "")) return;
  await ready;
  if (!UID) {
    toast("offline — your card is saved on this phone and will publish when you're back");
    authP.then(() => window.fitkinPublish());   // auth 가 살아나면 재시도
    return;
  }
  try {
    s.id = UID; put(s);
    await setDoc(doc(db, "profiles", UID), {
      name: s.name.slice(0, 30), sports: s.sports, vibe: s.vibe, days: s.days,
      zip: s.zip, ts: Date.now(),
    });
    s.published = Date.now(); put(s);
    paintHome();
    return true;
  } catch (e) {
    toast("couldn't publish — will retry next time you open fitkin");
    paintHome();
    return false;
  }
};

function overlap(mine, theirs) {
  return (mine || []).filter(x => (theirs || []).includes(x));
}

// ── 추천: 같은 ZIP(hood) + 앞3자리(nearby) ──
async function discover() {
  const s = st(); if (!s.zip) return { hood: [], near: [] };
  const p3 = s.zip.slice(0, 3);
  const [qz, qn] = await Promise.all([
    getDocs(query(collection(db, "profiles"), where("zip", "==", s.zip), limit(40))),
    getDocs(query(collection(db, "profiles"), orderBy("zip"),
                  where("zip", ">=", p3 + "00"), where("zip", "<=", p3 + "99"), limit(60))),
  ]);
  // 내가 차단한 사람은 추천에서도 숨긴다 (Apple 1.2)
  const blocked = await myBlocks();
  const seen = new Set([UID, ...blocked]);
  // 매칭 랭킹: 종목(x2) + 요일 겹침 + 시간대·에너지 일치 + 레벨 근접 — 카피 그대로의 매칭
  const LV = ["new-ish", "steady", "serious"];
  const rank = p => {
    let sc = overlap(s.sports, p.sports).length * 2;
    sc += Math.min(2, (s.days || []).filter(d => (p.days || []).includes(d)).length * 0.4);
    const v = s.vibe || {}, w = p.vibe || {};
    if (v.time && v.time === w.time) sc += 1;
    if (v.mode && v.mode === w.mode) sc += 1;
    if (v.level && w.level) sc += 1 - Math.min(1, Math.abs(LV.indexOf(v.level.trim()) - LV.indexOf(w.level.trim())) * 0.5);
    return -sc;
  };
  const safeRank = p => { try { return rank(p); } catch (e) { return 0; } };   // 조작 프로필 1건이 전체 추천을 죽이지 못하게
  const take = (qs, excludeZip) => {
    const out = [];
    qs.forEach(d => {
      const p = d.data();
      if (seen.has(d.id)) return;
      if (excludeZip && p.zip === s.zip) return;
      if (typeof p.name !== "string" || !Array.isArray(p.sports)) return;
      seen.add(d.id); out.push({ id: d.id, ...p });
    });
    return out.sort((a, b) => safeRank(a) - safeRank(b));
  };
  return { hood: take(qz, false), near: take(qn, true) };
}

function personRow(k, mine) {
  const shared = overlap(mine, k.sports);
  const em = ["🏃", "🎾", "🏋️", "🏊", "🚴", "🧗"][(k.name || "x").length % 6];
  // 프라이버시: 정밀 ZIP5 는 매칭에만 쓰고, 화면엔 권역(ZIP3xx)만 보여준다
  const area = (k.zip || "").slice(0, 3) + "xx";
  return `<div class="kinrow" data-kin="${esc(k.id)}" data-name="${esc(k.name)}">
    <span class="kava">${em}</span>
    <div style="flex:1"><b>${esc(k.name)}</b><p>${shared.length
      ? `<span class="overlap">you both: ${esc(shared.slice(0, 3).join(" · "))}</span>`
      : esc((k.sports || []).slice(0, 3).join(" · "))} · ${esc(area)}</p></div></div>`;
}

async function paintDiscover() {
  const wrap = $("#nearList"); if (!wrap) return;
  try {
    const s = st();
    const { hood, near } = await discover();
    const rows = [
      ...hood.map(k => personRow(k, s.sports)),
      ...(near.length ? [`<p class="dimtext" style="margin:10px 0 4px">nearby (${s.zip.slice(0,3)}xx)</p>`] : []),
      ...near.slice(0, 10).map(k => personRow(k, s.sports)),
    ];
    wrap.innerHTML = rows.length
      ? rows.join("") + `<p class="dimtext" style="margin-top:10px">see someone at the gym? scan their kin code to connect.</p>`
      : `<p class="dimtext">no one in ${s.zip} yet — you're first. share fitkin with your crew.</p>`;
  } catch (e) { wrap.innerHTML = `<p class="dimtext">couldn't load nearby kin — check connection.</p>`; }
}

// ── QR 킨코드 ──
// 네이티브 앱의 location 은 capacitor://localhost — 그대로 공유·QR에 넣으면
// 받는 쪽이 못 여는 죽은 링크가 된다. 웹이 아닐 땐 정식 웹 주소로 고정.
const WEB_APP_URL = "https://pbseq.github.io/fitkin/app/";
function kinUrl(id) {
  const onWeb = location.protocol.startsWith("http") && !["localhost", "127.0.0.1"].includes(location.hostname);
  return (onWeb ? location.origin + location.pathname : WEB_APP_URL) + "#kin=" + id;
}
window.fitkinDrawQR = function () {
  const s = st(); if (!s.id) return;
  const box = $("#qrCanvas"); if (!box || !window.qrcode) return;
  const q = qrcode(0, "M"); q.addData(kinUrl(s.id)); q.make();
  box.innerHTML = q.createSvgTag({ cellSize: 3, margin: 2 });
  const svg = box.querySelector("svg");
  svg.style.width = "100%"; svg.style.height = "100%"; svg.style.borderRadius = "12px";
};

// ── 스캐너 ──
let scanStream = null, scanRAF = 0;
window.fitkinScan = async function () {
  const box = $("#scanner"), vid = $("#scanVid");
  try { scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); }
  catch (e) { toast("camera permission needed to scan"); return; }
  vid.srcObject = scanStream; await vid.play();
  box.classList.add("on");
  const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
  const tick = () => {
    if (!scanStream) return;
    if (vid.videoWidth) {
      cv.width = vid.videoWidth; cv.height = vid.videoHeight;
      cx.drawImage(vid, 0, 0);
      const img = cx.getImageData(0, 0, cv.width, cv.height);
      const hit = window.jsQR && jsQR(img.data, img.width, img.height);
      if (hit && /#kin=[A-Za-z0-9]+/.test(hit.data)) {
        window.fitkinScanStop();
        location.hash = hit.data.slice(hit.data.indexOf("#kin="));
        return;
      }
    }
    scanRAF = requestAnimationFrame(tick);
  };
  scanRAF = requestAnimationFrame(tick);
};
window.fitkinScanStop = function () {
  cancelAnimationFrame(scanRAF);
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  $("#scanner").classList.remove("on");
};

// ── 킨 링크 수신 ──
async function handleKinLink() {
  const m = location.hash.match(/#kin=([A-Za-z0-9]+)/);
  if (!m) return;
  const other = m[1]; const s = st();
  history.replaceState(null, "", location.pathname);
  if (!s.id) { s.pendingKin = other; put(s); return; }
  if (other === s.id) return;
  try {
    await ready;
    const them = await getDoc(doc(db, "profiles", other));
    if (!them.exists()) { toast("that kin code doesn't exist (yet)"); return; }
    const linkId = [UID, other].sort().join("_");
    const existing = await getDoc(doc(db, "links", linkId));
    if (existing.exists()) { toast("already kin with " + (them.data().name || "them") + " ✓"); paintKin(); return; }
    await setDoc(doc(db, "links", linkId), { a: UID < other ? UID : other, b: UID < other ? other : UID, ts: Date.now() });
    const shared = overlap(s.sports, them.data().sports);
    toast("you're kin with " + (them.data().name || "someone") + " 🎉" +
          (shared.length ? " — you both: " + shared.join(" · ") : ""));
    paintKin();
  } catch (e) { toast("couldn't connect — try again online"); }
}
window.addEventListener("hashchange", handleKinLink);

// ── 킨 목록 (탭하면 채팅) ──
async function myKin() {
  if (!UID) return [];
  const [qa, qb] = await Promise.all([
    getDocs(query(collection(db, "links"), where("a", "==", UID), limit(50))),
    getDocs(query(collection(db, "links"), where("b", "==", UID), limit(50)))]);
  const ids = new Set();
  qa.forEach(d => ids.add(d.data().b)); qb.forEach(d => ids.add(d.data().a));
  const out = [];
  for (const id of ids) {
    const p = await getDoc(doc(db, "profiles", id));
    if (p.exists()) out.push({ id, ...p.data() });
  }
  return out;
}

async function paintKin() {
  const wrap = $("#kinList"); if (!wrap) return;
  const s = st();
  let kin = await myKin();
  // 내가 차단한 킨은 목록에서 숨긴다
  const keep = [];
  for (const k of kin) { if (!(await isBlockedByMe(k.id))) keep.push(k); }
  kin = keep;
  wrap.innerHTML = kin.length
    ? kin.map(k => personRow(k, s.sports)).join("")
      + `<p class="dimtext" style="margin-top:8px">tap a kin to message them.</p>`
    : `<p class="dimtext">no kin yet — show your code to someone at the gym.</p>`;
  wrap.querySelectorAll(".kinrow").forEach(r =>
    r.onclick = () => openChat(r.dataset.kin, r.dataset.name));
}

// ── 차단·신고 (Apple 1.2 UGC 안전장치) — blocks/{내uid}/users/{상대uid} ──
async function myBlocks() {
  if (!UID) return new Set();
  try {
    const qs = await getDocs(collection(db, "blocks", UID, "users"));
    return new Set(qs.docs.map(d => d.id));
  } catch (e) { return new Set(); }
}
async function isBlockedByMe(otherId) {
  if (!UID) return false;
  const b = await getDoc(doc(db, "blocks", UID, "users", otherId));
  return b.exists();
}
window.fitkinBlock = async function (otherId, otherName) {
  if (!confirm(`block ${otherName}? they won't be able to message you.`)) return;
  try {
    await setDoc(doc(db, "blocks", UID, "users", otherId), { ts: Date.now() });
    toast(otherName + " blocked");
    window.fitkinChatClose(); paintKin(); paintDiscover();
  } catch (e) { toast("couldn't block — try again online"); }
};
window.fitkinReport = async function (otherId, otherName) {
  const reason = prompt(`report ${otherName} — what happened?`);
  if (reason === null) return;
  try {
    // 인앱 신고 기록 (운영자가 검토) + 이메일 병행 경로
    await setDoc(doc(db, "reports", UID + "_" + otherId + "_" + Date.now()),
                 { by: UID, about: otherId, reason: String(reason).slice(0, 300), ts: Date.now() });
    toast("report sent — we review every one");
  } catch (e) {
    location.href = "mailto:pathobrainseq@gmail.com?subject=fitkin%20report"
      + "&body=" + encodeURIComponent(`reporting user: ${otherName} (${otherId})\nreason: ${reason || ""}`);
  }
};

// ── 메시지 (킨 전용 1:1) ──
let chatUnsub = null;
async function openChat(otherId, otherName) {
  await ready;
  if (!UID) { toast("connect to the internet to message"); return; }
  const linkId = [UID, otherId].sort().join("_");
  $("#chatName").textContent = otherName || "kin";
  $("#chatBlock").onclick = () => window.fitkinBlock(otherId, otherName);
  $("#chatReport").onclick = () => window.fitkinReport(otherId, otherName);
  $("#chat").classList.add("on");
  $("#chatSend").onclick = async () => {
    const inp = $("#chatInput"), text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    try {
      await addDoc(collection(db, "messages", linkId, "msgs"),
                   { from: UID, text: text.slice(0, 200), ts: Date.now() });
    } catch (e) { toast("message didn't send — are you still kin?"); }
  };
  $("#chatInput").onkeydown = e => { if (e.key === "Enter") $("#chatSend").click(); };
  if (chatUnsub) chatUnsub();
  chatUnsub = onSnapshot(
    query(collection(db, "messages", linkId, "msgs"), orderBy("ts"), limitToLast(100)),
    snap => {
      const box = $("#chatMsgs");
      box.innerHTML = snap.empty
        ? `<p class="dimtext" style="text-align:center;margin-top:20px">say hi — plan a workout 👋</p>`
        : [...snap.docs].map(d => {
            const m = d.data();
            return `<div class="msg ${m.from === UID ? "me" : ""}">${esc(m.text)}</div>`;
          }).join("");
      box.scrollTop = box.scrollHeight;
    },
    () => { $("#chatMsgs").innerHTML = `<p class="dimtext">couldn't open this chat.</p>`; });
}
window.fitkinChatClose = function () {
  if (chatUnsub) { chatUnsub(); chatUnsub = null; }
  $("#chat").classList.remove("on");
};

// ── 링크 공유 — 네이티브는 시스템 공유 시트(플러그인), 웹은 navigator.share.
//    어느 단계가 죽어도 다음 폴백으로: 시트 → share API → 클립보드 → 링크 표시.
window.fitkinShare = async function () {
  const s = st(); if (!s.id) { toast("your code is still being made — try in a sec"); return; }
  const url = kinUrl(s.id);
  const NS = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
  try {
    if (NS) { await NS.share({ title: "be my fitkin", url }); return; }
  } catch (e) { if (String(e.message || e).toLowerCase().includes("cancel")) return; }
  try {
    if (navigator.share) { await navigator.share({ title: "be my fitkin", url }); return; }
  } catch (e) { if (String(e.name).includes("Abort")) return; }
  try {
    await navigator.clipboard.writeText(url);
    toast("link copied — send it to your kin"); return;
  } catch (e) {}
  prompt("copy your kin link:", url);
};

// ── 홈 ──
let pubRetried = false;
async function paintHome() {
  const s = st(); if (!s.done) return;
  await ready;
  // 완전 오프라인: 스피너 대신 정직한 폴백을 그리고, 회복되면 자동 재도색
  if (!UID) {
    const off = `<p class="dimtext">you're offline — this loads when you're back.</p>`;
    if ($("#kinList")) $("#kinList").innerHTML = off;
    if ($("#nearList")) $("#nearList").innerHTML = off;
    const qb = $("#qrCanvas");
    if (qb) qb.innerHTML = `<span class="dimtext" style="font-size:11px;text-align:center">offline —<br>code loads later</span>`;
    authP.then(() => paintHome());
    return;
  }
  // 발행이 안 된 카드가 있으면 홈에 올 때 1회 자동 재시도 (약속 이행)
  if (!s.published && !pubRetried) { pubRetried = true; window.fitkinPublish(); return; }
  window.fitkinDrawQR();
  paintKin();
  paintDiscover();
  if (s.pendingKin) { const p = s.pendingKin; delete s.pendingKin; put(s); location.hash = "#kin=" + p; handleKinLink(); }
}

function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.className = "show";
  setTimeout(() => t.className = "", 3200);
}

// ── 출장 모드: 현재 지역 빠른 전환 (온보딩 재주행 없이) ──
window.fitkinArea = async function () {
  const s = st();
  const z = prompt("traveling? set your current zip (5 digits).\nyou'll see kin there and they'll see you.", s.zip || "");
  if (z === null) return;
  if (!/^[0-9]{5}$/.test(z.trim())) { toast("that's not a 5-digit zip"); return; }
  s.homeZip = s.homeZip || s.zip;   // 첫 전환 때 홈 존 기억
  s.zip = z.trim(); s.published = 0; put(s);   // 재시도 기계 재장전
  const ok = await window.fitkinPublish();
  if (ok) { toast(s.zip === s.homeZip ? "back home 🏠" : "now finding kin in " + s.zip + " ✈️"); paintDiscover(); }
};
window.fitkinAreaHome = async function () {
  const s = st();
  if (!s.homeZip || s.homeZip === s.zip) { toast("you're already home 🏠"); return; }
  s.zip = s.homeZip; s.published = 0; put(s);
  const ok = await window.fitkinPublish();
  if (ok) { toast("back home 🏠"); paintDiscover(); }
};

// ── 프로필 완전 삭제 (privacy 약속 이행: 서버 데이터까지 지운다) ──
window.fitkinDelete = async function () {
  if (!confirm("delete your account everywhere? this removes your card and your sign-in from fitkin's servers and this phone.")) return;
  try {
    await ready;
    if (UID) {
      const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      await deleteDoc(doc(db, "profiles", UID));
    }
    // 계정 삭제 의무(심사 5.1.1(v)): 프로필 문서만이 아니라 Auth 계정(이메일 포함)까지.
    // requires-recent-login 이면 문서는 이미 지워졌으므로 로그아웃으로 마무리한다.
    if (auth.currentUser) {
      const { deleteUser, signOut } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      try { await deleteUser(auth.currentUser); }
      catch (e2) { try { await signOut(auth); } catch (e3) {} }
    }
    localStorage.removeItem("fitkin");
    toast("deleted. take care out there 💚");
    setTimeout(() => location.reload(), 1200);
  } catch (e) { toast("couldn't reach the server — try again online"); }
};

window.fitkinHome = paintHome;
handleKinLink();
if (st().done) ready.then(paintHome);
