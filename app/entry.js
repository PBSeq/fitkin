// fitkin v1.2 — 익명인증(uid) + 지역 매칭(미국 ZIP 또는 글로벌 ~5km 셀) + 킨 메시지.
// 프라이버시 원칙: 정밀 좌표는 기기 밖으로 안 나간다 — 위치를 쓰면 기기에서
// geohash5(~4.9km) 셀로 변환해 셀 ID만 저장. ZIP "근처" = 앞 3자리, 셀 "근처" = 3x3 이웃권.
import { initializeApp } from "firebase/app";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, signInAnonymously, onAuthStateChanged, signInWithCredential, GoogleAuthProvider, OAuthProvider, deleteUser, linkWithCredential, linkWithPopup, reauthenticateWithCredential, reauthenticateWithPopup, signInWithPopup, signOut }
  from "firebase/auth";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, limit, limitToLast, addDoc, onSnapshot, deleteDoc, updateDoc }
  from "firebase/firestore";

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

// ── 글로벌 그리드 (v1.2): 좌표→geohash5 셀(≈4.9km). 좌표는 기기에서 즉시 폐기,
//    셀 ID만 저장 — "정밀 위치 미저장" 원칙 유지. ZIP(미국)과 공존한다.
const GH32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const CELL_RE = /^[0-9b-hjkmnp-z]{5}$/;
const validCell = c => typeof c === "string" && CELL_RE.test(c);
// 이웃 셀: cell4 중심을 디코드해 ±셀폭 오프셋 후 재인코드 — 인코더와 자동 정합,
// 날짜변경선은 경도 랩, 극지방은 자연 축소. 셀 경계 바로 건너의 킨도 보이게.
function cellDecode4(c4) {
  let latR = [-90, 90], lonR = [-180, 180], even = true;
  for (const ch of c4) {
    const ci = GH32.indexOf(ch);
    for (let b = 4; b >= 0; b--) {
      const bit = (ci >> b) & 1;
      if (even) { const m = (lonR[0] + lonR[1]) / 2; if (bit) lonR[0] = m; else lonR[1] = m; }
      else { const m = (latR[0] + latR[1]) / 2; if (bit) latR[0] = m; else latR[1] = m; }
      even = !even;
    }
  }
  return { lat: (latR[0] + latR[1]) / 2, lon: (lonR[0] + lonR[1]) / 2,
           dlat: latR[1] - latR[0], dlon: lonR[1] - lonR[0] };
}
function cellNeighborhood(c4) {
  const c = cellDecode4(c4), out = new Set();
  for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) {
    const lat = c.lat + i * c.dlat;
    if (lat <= -90 || lat >= 90) continue;         // 극 바깥 — 이웃 없음
    let lon = c.lon + j * c.dlon;
    if (lon >= 180) lon -= 360; if (lon < -180) lon += 360;   // 날짜변경선 랩
    out.add(geohash5(lat, lon).slice(0, 4));
  }
  return [...out];
}
function geohash5(lat, lon) {
  let latR = [-90, 90], lonR = [-180, 180], bit = 0, ch = 0, even = true, out = "";
  while (out.length < 5) {
    if (even) { const m = (lonR[0] + lonR[1]) / 2;
      if (lon >= m) { ch = ch * 2 + 1; lonR[0] = m; } else { ch *= 2; lonR[1] = m; } }
    else { const m = (latR[0] + latR[1]) / 2;
      if (lat >= m) { ch = ch * 2 + 1; latR[0] = m; } else { ch *= 2; latR[1] = m; } }
    even = !even;
    if (++bit === 5) { out += GH32[ch]; bit = 0; ch = 0; }
  }
  return out;
}
// 위치 1회 요청 → 셀 저장 → 재발행. 좌표는 이 함수 스코프 밖으로 나가지 않는다.
window.fitkinUseLocation = function (travel) {
  if (!navigator.geolocation) { toast("location isn't available on this device — type your ZIP instead"); return; }
  toast("finding your area…");
  navigator.geolocation.getCurrentPosition(async pos => {
    const cell = geohash5(pos.coords.latitude, pos.coords.longitude);
    const s = st();
    if (travel) {
      if (s.homeZip === undefined) s.homeZip = s.zip || "";
      if (s.homeCell === undefined) s.homeCell = s.cell || "";
    }
    if (travel) s.zip = "";           // 출장 지역에선 홈 ZIP 매칭이 새면 안 된다
    s.cell = cell; s.published = 0; put(s);
    const zipEl = document.getElementById("fZip");
    if (zipEl) { zipEl.placeholder = "area set \u2713 \u2014 or type a US ZIP"; zipEl.dispatchEvent(new Event("input")); }
    toast("area set \u2713 \u2014 we only keep a rough ~5km area, never your exact spot");
    if (s.done) { const ok = await window.fitkinPublish(); if (ok) paintDiscover(); }
  }, err => {
    toast(err.code === 1 ? "no worries — type your ZIP instead" : "couldn't get your location — type your ZIP instead");
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
};

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
      return await linkWithCredential(auth.currentUser, c);
    }
  } catch (e) {
    if (!String(e.code).includes("credential-already-in-use") &&
        !String(e.code).includes("provider-already-linked")) throw e;
  }
  return signInWithCredential(auth, c);
}
function nativeSL() {
  return window.Capacitor && window.Capacitor.isNativePlatform &&
         window.Capacitor.isNativePlatform() &&
         window.Capacitor.Plugins && window.Capacitor.Plugins.SocialLogin;
}
// 네이티브 로그인 시트를 띄워 Firebase 자격증명을 만든다 (로그인·재인증 공용)
async function nativeCred(kind) {
  const SL = nativeSL();
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
  return kind === "apple"
    ? new OAuthProvider("apple.com").credential(
        rawNonce ? { idToken, rawNonce } : { idToken })
    : GoogleAuthProvider.credential(idToken);
}
window.fitkinLogin = async function (kind) {
  try {
    let cred;
    if (nativeSL()) {
      cred = await credLogin(await nativeCred(kind));
    } else {
      const provider = kind === "apple" ? new OAuthProvider("apple.com") : new GoogleAuthProvider();
      // 웹도 네이티브와 동일하게: 익명 세션에 링크(UID 보존), 기존 계정이면 signIn 폴백
      await ready;
      try {
        if (auth.currentUser && auth.currentUser.isAnonymous)
          cred = await linkWithPopup(auth.currentUser, provider, browserPopupRedirectResolver);
      } catch (e) {
        if (!String(e.code).includes("credential-already-in-use") &&
            !String(e.code).includes("provider-already-linked")) throw e;
      }
      if (!cred) cred = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    }
    const s = st();
    // 링크 로그인은 top-level displayName 이 비어 있다 — providerData 에서 폴백
    s.loginName = cred.user.displayName ||
      (((cred.user.providerData || []).find(p => p && p.displayName) || {}).displayName) || "";
    put(s);
    UID = cred.user.uid;
    // 이 계정으로 만든 카드가 서버에 있으면 그대로 복원 — 재설치·재로그인 관통.
    // 로컬 카드의 주인(s.id)과 로그인 계정이 다르면(기존 계정으로 signIn 폴백된 경우)에도
    // 서버 카드를 우선 복원하고, 서버에 없으면 로컬 카드를 새 계정에 이식한다.
    const s2 = st();
    const mismatch = !!(s2.id && s2.id !== cred.user.uid);
    if (!s2.done || mismatch) {
      try {
        const snap = await getDoc(doc(db, "profiles", cred.user.uid));
        if (snap.exists()) {
          const d = snap.data();
          put({ ...st(), id: cred.user.uid, name: d.name, sports: d.sports, vibe: d.vibe,
                days: d.days, zip: d.zip, done: 1, published: Date.now(),
                ...(validCell(d.cell) ? { cell: d.cell } : {}),
                ...(typeof d.photo === "string" && d.photo.startsWith("data:image/jpeg;base64,")
                    ? { photoData: d.photo } : {}) });
          toast("welcome back, " + d.name + " ✓");
          // 홈 카드 헤더는 인라인 renderCard 만 그릴 수 있다 — 리로드로 전체 재부팅
          setTimeout(() => location.reload(), 900);
          return;
        }
      } catch (e) {}
      if (mismatch && s2.done) {
        s2.id = cred.user.uid; s2.published = 0; put(s2);
        window.fitkinPublish();
      }
    }
    toast("signed in" + (s.loginName ? " as " + s.loginName.split(" ")[0] : "") + " ✓");
    const row = $("#loginRow"); if (row) row.style.display = "none";
    const nameEl = $("#fName");
    if (nameEl && !nameEl.value && s.loginName) { nameEl.value = s.loginName.split(" ")[0]; nameEl.dispatchEvent(new Event("input")); }
    paintAcct();
  } catch (e) {
    if (String(e.code).includes("account-exists-with-different-credential"))
      toast("that email is already tied to your other sign-in — try the other button");
    else if (String(e.code).includes("operation-not-allowed"))
      toast("sign-in isn't available right now — guest mode works fine");
    else if (!String(e.code).includes("popup-closed") && !String(e.code).includes("canceled"))
      toast("login hiccup — guest mode works fine");
  }
};
// 로그아웃: 카드·킨은 서버에 남는다. 재로그인하면 그대로 복원.
window.fitkinSignOut = async function () {
  if (!confirm("sign out? your card and kin stay safe — sign back in anytime to get them back.")) return;
  try {
    await signOut(auth);
  } catch (e) {}
  localStorage.removeItem("fitkin");
  location.reload();
};
// 홈 하단 계정 행: 게스트에겐 로그인 진입점, 로그인 유저에겐 로그아웃
function paintAcct() {
  const el = $("#acctRow"); if (!el) return;
  const u = auth.currentUser;
  if (u && !u.isAnonymous) {
    const nm = (st().loginName ||
      (((u.providerData || []).find(p => p && p.displayName) || {}).displayName) ||
      u.email || "you").split(" ")[0];
    el.innerHTML = `signed in as <b style="color:var(--mint)">${esc(nm)}</b> ·
      <a href="#" onclick="fitkinSignOut();return false" style="color:var(--mint)">sign out</a>`;
  } else {
    el.innerHTML = `guest mode — sign in to keep your card:
      <a href="#" onclick="fitkinLogin('apple');return false" style="color:var(--mint)">apple</a> ·
      <a href="#" onclick="fitkinLogin('google');return false" style="color:var(--mint)">google</a>`;
  }
}

// ── 프로필 발행 (uid 문서 — 본인만 쓰기, redo 는 같은 문서 갱신) ──
// UID 없이는 절대 쓰지 않는다 (profiles/null 방지). auth 회복 시 자동 재시도.
window.fitkinPublish = async function () {
  const s = st();
  if (s.cell && !validCell(s.cell)) { delete s.cell; put(s); }   // 불량 셀 자가치유
  if (!s.name || (!/^[0-9]{5}$/.test(s.zip || "") && !validCell(s.cell))) return;
  await ready;
  if (!UID) {
    toast("offline — your card is saved on this phone and will publish when you're back");
    authP.then(() => window.fitkinPublish());   // auth 가 살아나면 재시도
    return;
  }
  try {
    s.id = UID; put(s);
    const payload = {
      name: s.name.slice(0, 30), sports: s.sports, vibe: s.vibe, days: s.days,
      ts: Date.now(),
    };
    if (/^[0-9]{5}$/.test(s.zip || "")) payload.zip = s.zip;
    if (validCell(s.cell)) { payload.cell = s.cell; payload.cell4 = s.cell.slice(0, 4); }
    if (s.hidden) payload.hidden = true;
    if (s.photoData) payload.photo = s.photoData;
    await setDoc(doc(db, "profiles", UID), payload);
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
  const s = st(); if (!s.zip && !validCell(s.cell)) return { hood: [], near: [] };
  const jobs = [];
  if (s.zip) {
    const p3 = s.zip.slice(0, 3);
    jobs.push(getDocs(query(collection(db, "profiles"), where("zip", "==", s.zip), limit(40))));
    jobs.push(getDocs(query(collection(db, "profiles"), orderBy("zip"),
      where("zip", ">=", p3 + "00"), where("zip", "<=", p3 + "99"), limit(60))));
  }
  if (validCell(s.cell)) {
    jobs.push(getDocs(query(collection(db, "profiles"), where("cell", "==", s.cell), limit(40))));
    jobs.push(getDocs(query(collection(db, "profiles"),
      where("cell4", "in", cellNeighborhood(s.cell.slice(0, 4))), limit(60))));
  }
  const res = await Promise.all(jobs);
  // [hood 쿼리들, nearby 쿼리들] 순서로 병합
  const hoodQs = [], nearQs = [];
  let i = 0;
  if (s.zip) { hoodQs.push(res[i++]); nearQs.push(res[i++]); }
  if (validCell(s.cell)) { hoodQs.push(res[i++]); nearQs.push(res[i++]); }
  const qz = { forEach: cb => hoodQs.forEach(q => q.forEach(cb)) };
  const qn = { forEach: cb => nearQs.forEach(q => q.forEach(cb)) };
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
  const take = (qs, excludeHood) => {
    const out = [];
    qs.forEach(d => {
      const p = d.data();
      if (seen.has(d.id)) return;
      if (p.hidden) return;   // "그만 찾기" 상태 — 리스트업에서 내려간다 (킨 링크·채팅은 유지)
      if (excludeHood && ((s.zip && p.zip === s.zip) || (s.cell && p.cell === s.cell))) return;
      if (typeof p.name !== "string" || !Array.isArray(p.sports)) return;
      seen.add(d.id); out.push({ id: d.id, ...p });
    });
    return out.sort((a, b) => safeRank(a) - safeRank(b));
  };
  return { hood: take(qz, false), near: take(qn, true) };
}

// 이름 시드 그라데이션 + 이니셜 아바타 — 이모지 대신 프로덕트급 기본 아바타.
// 같은 이름이면 항상 같은 색(결정적). 사진이 오면 사진이 이긴다.
function avatarSvg(name, size) {
  let h = 0; for (const ch of String(name || "?")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const h1 = h % 360, h2 = (h1 + 40 + ((h >> 8) % 80)) % 360;
  const init = String(name || "?").trim().charAt(0).toLowerCase().replace(/[<>&"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1},72%,46%)"/><stop offset="1" stop-color="hsl(${h2},76%,28%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(%23g)"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="-apple-system,Helvetica,sans-serif" font-weight="800" font-size="${Math.round(size * 0.46)}" fill="rgba(255,255,255,.93)">${init}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg).replace(/%2523/g, "%23");
}
window.fitkinAvatar = avatarSvg;
function personRow(k, mine) {
  const shared = overlap(mine, k.sports);
  // 프로필 사진이 있으면 사진 아바타 (data URL 은 서버 규칙이 JPEG base64 만 허용)
  const av = (typeof k.photo === "string" && k.photo.startsWith("data:image/jpeg;base64,"))
    ? `<img src="${esc(k.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`
    : `<img src="${avatarSvg(k.name, 80)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
  // 프라이버시: 정밀 ZIP5/cell5 는 매칭에만, 화면엔 성긴 권역만
  const area = k.zip ? k.zip.slice(0, 3) + "xx" : (k.cell ? "area " + k.cell.slice(0, 4) : "nearby");
  return `<div class="kinrow" data-kin="${esc(k.id)}" data-name="${esc(k.name)}">
    <span class="kava">${av}</span>
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
      ...(near.length ? [`<p class="dimtext" style="margin:10px 0 4px">nearby (${s.zip ? s.zip.slice(0,3) + "xx" : "your area"})</p>`] : []),
      ...near.slice(0, 10).map(k => personRow(k, s.sports)),
    ];
    wrap.innerHTML = rows.length
      ? rows.join("") + `<p class="dimtext" style="margin-top:10px">see someone at the gym? scan their kin code to connect.</p>`
      : `<p class="dimtext">no one around here yet — you're first. share fitkin with your crew.</p>`;
    decorateRows(wrap);
  } catch (e) { wrap.innerHTML = `<p class="dimtext">couldn't load nearby kin — check connection.</p>`; }
}

// ── 사진: 프로필 사진 + 운동 모먼트 (박사님 지시 08/26) ──
// 저장은 Firestore 인라인 JPEG data URL — Storage 결제 없이 무료 티어로 간다.
// 부적절 사진은 3중 방어: ①업로드 시점 온디바이스 NSFW 검사 ②사진별 신고 ③운영자 ban.
function pickImage(maxDim, square) {
  return new Promise(res => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return res(null);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const c = document.createElement("canvas");
        if (square) {
          const side = Math.min(img.width, img.height);
          c.width = c.height = Math.min(maxDim, side);
          c.getContext("2d").drawImage(img,
            (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, c.width, c.height);
        } else {
          const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
          c.width = Math.max(1, Math.round(img.width * sc));
          c.height = Math.max(1, Math.round(img.height * sc));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        }
        res(c);
      };
      img.onerror = () => res(null);
      img.src = URL.createObjectURL(f);
    };
    inp.click();
  });
}
// 온디바이스 NSFW 검사 — 모델 번들(≈5MB)은 지연 로드하되 부팅 직후 미리 데운다.
// 로드가 60초를 넘거나 실패하면 검사를 생략하고 통과시킨다 — 어떤 경우에도
// 업로드 흐름이 죽지 않게. 신고·인간검토(24h)·ban 이 2차 방어로 받는다.
let nsfwModelP = null;
function nsfwWarm() {
  if (nsfwModelP) return nsfwModelP;
  nsfwModelP = (async () => {
    if (!window.__nsfw) {
      await new Promise((res, rej) => {
        const sc = document.createElement("script");
        sc.src = "nsfw-bundle.js"; sc.onload = res;
        sc.onerror = () => rej(new Error("nsfw bundle load failed"));
        document.head.appendChild(sc);
      });
    }
    try { await window.__nsfw.tf.ready(); } catch (e) {}
    return window.__nsfw.load("MobileNetV2", { modelDefinitions: [window.__nsfw.MobileNetV2Model] });
  })();
  nsfwModelP.catch(() => { nsfwModelP = null; });   // 실패했으면 다음에 재시도
  return nsfwModelP;
}
setTimeout(() => { try { if (st().done) nsfwWarm(); } catch (e) {} }, 8000);
async function nsfwOk(canvas) {
  try {
    const model = await Promise.race([nsfwWarm(),
      new Promise(r => setTimeout(() => r(null), 60000))]);
    if (!model) return true;
    const preds = await model.classify(canvas);
    const p = n => ((preds.find(x => x.className === n) || {}).probability) || 0;
    // 운동복·수영복은 Sexy 로 자주 오탐된다 — Porn/Hentai 는 낮게, Sexy 는 높게 끊는다
    return (p("Porn") + p("Hentai")) < 0.4 && p("Sexy") < 0.8;
  } catch (e) { return true; }
}
window.fitkinSetPhoto = async function () {
  const c = await pickImage(256, true);
  if (!c) return;
  toast("checking photo — first time can take a moment…");
  if (!(await nsfwOk(c))) { toast("that photo isn't workout-appropriate 🙅"); return; }
  let q = 0.72, url = c.toDataURL("image/jpeg", q);
  while (url.length > 290000 && q > 0.3) { q -= 0.12; url = c.toDataURL("image/jpeg", q); }
  if (url.length > 290000) { toast("photo too large — try another"); return; }
  const s = st(); s.photoData = url; s.published = 0; put(s);
  if (window.renderCard) window.renderCard();
  const ok = await window.fitkinPublish();
  toast(ok ? "looking good ✓" : "photo saved — publishes when you're back online");
};
window.fitkinMoment = async function () {
  const s = st();
  if (s.cell && !validCell(s.cell)) { delete s.cell; put(s); }   // 불량 셀 자가치유
  if (!s.published) { toast("build your kin card first"); return; }
  if (!/^[0-9]{5}$/.test(s.zip || "") && !validCell(s.cell)) {
    toast("set your area first — type a zip or tap 📍 use my location"); return; }
  const c = await pickImage(800, false);
  if (!c) return;
  toast("checking photo — first time can take a moment…");
  if (!(await nsfwOk(c))) { toast("that photo isn't workout-appropriate 🙅"); return; }
  let q = 0.72, url = c.toDataURL("image/jpeg", q);
  while (url.length > 690000 && q > 0.3) { q -= 0.12; url = c.toDataURL("image/jpeg", q); }
  if (url.length > 690000) { toast("photo too large — try another"); return; }
  const caption = (prompt("caption? (optional)") || "").slice(0, 100);
  await ready;
  if (!UID) { toast("you're offline — try again when you're back"); return; }
  try {
    const ph = { owner: UID, name: (s.name || "").slice(0, 30), img: url, caption, ts: Date.now() };
    if (/^[0-9]{5}$/.test(s.zip || "")) ph.zip = s.zip;
    if (validCell(s.cell)) { ph.cell = s.cell; ph.cell4 = s.cell.slice(0, 4); }
    await addDoc(collection(db, "photos"), ph);
    toast("moment shared 📸");
    paintFeed();
  } catch (e) { toast("couldn't share — try again"); }
};
window.fitkinReportPhoto = async function (id) {
  if (!confirm("report this photo as inappropriate? a human reviews every report.")) return;
  try {
    await ready; if (!UID) { toast("offline — try again later"); return; }
    await addDoc(collection(db, "reports"),
      { by: UID, about: "photo:" + id, reason: "inappropriate photo", ts: Date.now() });
    toast("reported — thank you. we review every report.");
  } catch (e) { toast("couldn't send the report — try again"); }
};
window.fitkinDeletePhoto = async function (id) {
  if (!confirm("delete this moment?")) return;
  try {
    await deleteDoc(doc(db, "photos", id)); toast("deleted"); paintFeed();
  } catch (e) { toast("couldn't delete — try again"); }
};

// ── 킨 피드: 근처 전체를 브라우즈 + 종목 필터 (박사님 지시 08/26) ──
const FEED_SPORTS = ["running", "lifting", "tennis", "swimming", "cycling",
                     "hiking", "yoga", "hoops", "soccer", "pickleball", "boxing", "climbing"];
let feedSport = "";
let feedLevel = "";
let feedTime = "";
let feedMode = "people";
window.fitkinFeedTab = function (mode) {
  feedMode = mode;
  const tp = $("#ftabPeople"), tm = $("#ftabMoments"), sh = $("#fShare"), ch = $("#feedChips");
  if (tp) tp.classList.toggle("sel", mode === "people");
  if (tm) tm.classList.toggle("sel", mode === "moments");
  if (sh) sh.style.display = mode === "moments" ? "" : "none";
  if (ch) ch.style.display = mode === "moments" ? "none" : "";
  paintFeed();
};
async function paintMoments() {
  const s = st();
  const sub = $("#feedSub");
  if (sub) sub.textContent = `workout moments around ${s.zip ? s.zip.slice(0, 3) + "xx" : "your area"} — kin sharing the grind.`;
  const wrap = $("#feedList"); if (!wrap) return;
  try {
    await ready;
    const jobs = [];
    if (s.zip) {
      const p3 = s.zip.slice(0, 3);
      jobs.push(getDocs(query(collection(db, "photos"), orderBy("zip"),
        where("zip", ">=", p3 + "00"), where("zip", "<=", p3 + "99"), limit(30))));
    }
    if (validCell(s.cell)) {
      jobs.push(getDocs(query(collection(db, "photos"),
        where("cell4", "in", cellNeighborhood(s.cell.slice(0, 4))), limit(30))));
    }
    const res = await Promise.all(jobs);
    const qs = { forEach: cb => { const ids = new Set();
      res.forEach(q => q.forEach(d => { if (!ids.has(d.id)) { ids.add(d.id); cb(d); } })); } };
    const blocked = await myBlocks();   // Set
    const items = [];
    qs.forEach(d => {
      const p = d.data();
      if (blocked.has(p.owner)) return;
      if (typeof p.img !== "string" || !p.img.startsWith("data:image/jpeg;base64,")) return;
      items.push({ id: d.id, ...p });
    });
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    wrap.innerHTML = items.length
      ? items.map(m => `<div class="moment">
          <img src="${esc(m.img)}" alt="">
          <div class="moment-meta">
            <b>${esc(m.name)}</b> · ${esc(m.zip ? m.zip.slice(0, 3) + "xx" : "your area")}
            ${m.caption ? " · " + esc(m.caption) : ""}
            <span style="margin-left:auto;display:flex;gap:10px">
              ${m.owner === UID
                ? `<a href="#" onclick="fitkinDeletePhoto('${esc(m.id)}');return false" style="color:var(--mint)">delete</a>`
                : `<a href="#" onclick="fitkinReportPhoto('${esc(m.id)}');return false" style="color:var(--mint)">report</a>`}
            </span>
          </div></div>`).join("")
      : `<p class="dimtext" style="margin-top:14px">no moments around here yet —
         be the first: tap <b>+ share</b> after a workout with your kin. 📸</p>`;
  } catch (e) { wrap.innerHTML = `<p class="dimtext">couldn't load moments — check connection.</p>`; }
}
window.fitkinFeed = function () {
  $("#feed").classList.add("on"); paintFeed();
  const list = $("#feedList");
  if (list && !list.dataset.wired) {
    list.dataset.wired = 1;
    // 연결은 QR 의도 공유로만 — 피드에서 탭하면 그 원칙을 알려준다
    list.addEventListener("click", e => {
      const row = e.target.closest(".kinrow");
      if (row) toast("to connect with " + row.dataset.name + ", scan their kin code in person 🤝");
    });
  }
};
window.fitkinFeedClose = function () { $("#feed").classList.remove("on"); };
window.fitkinFeedFilter = function (sp) { feedSport = sp === feedSport ? "" : sp; paintFeed(); };
window.fitkinFeedLevel = function (lv) { feedLevel = lv === feedLevel ? "" : lv; paintFeed(); };
window.fitkinFeedTime = function (t) { feedTime = t === feedTime ? "" : t; paintFeed(); };
async function paintFeed() {
  if (feedMode === "moments") return paintMoments();
  const s = st();
  const chips = $("#feedChips");
  if (chips) chips.innerHTML =
    [`<button class="fchip${feedSport ? "" : " sel"}" onclick="fitkinFeedFilter('')">all</button>`,
     ...FEED_SPORTS.map(sp =>
       `<button class="fchip${feedSport === sp ? " sel" : ""}" onclick="fitkinFeedFilter('${sp}')">${esc(sp)}</button>`)].join("");
  const chips2 = $("#feedChips2");
  if (chips2) chips2.innerHTML =
    [...["new-ish", "steady", "serious"].map(lv =>
       `<button class="fchip${feedLevel === lv ? " sel" : ""}" onclick="fitkinFeedLevel('${lv}')">${esc(lv)}</button>`),
     ...[["🌅 mornings", "🌅"], ["☀️ daytime", "☀️"], ["🌙 nights", "🌙"]].map(([t, ico]) =>
       `<button class="fchip${feedTime === t ? " sel" : ""}" onclick="fitkinFeedTime('${t}')">${ico} ${esc(t.split(" ")[1])}</button>`)].join("");
  const sub = $("#feedSub");
  if (sub) sub.textContent = s.zip
    ? `kin in ${s.zip} and nearby (${s.zip.slice(0, 3)}xx) — tap a sport to filter.`
    : `kin in and around your area — tap a sport to filter.`;
  const wrap = $("#feedList"); if (!wrap) return;
  try {
    const { hood, near } = await discover();
    const flt = k => (!feedSport || (k.sports || []).includes(feedSport))
      && (!feedLevel || ((k.vibe || {}).level || "").trim() === feedLevel)
      && (!feedTime || (k.vibe || {}).time === feedTime);
    const h = hood.filter(flt), n = near.filter(flt);
    const rows = [
      ...h.map(k => personRow(k, s.sports)),
      ...(n.length ? [`<p class="dimtext" style="margin:10px 0 4px">nearby (${s.zip ? s.zip.slice(0, 3) + "xx" : "your area"})</p>`] : []),
      ...n.map(k => personRow(k, s.sports)),
    ];
    wrap.innerHTML = rows.length
      ? rows.join("")
      : `<p class="dimtext">${feedSport
          ? `no ${esc(feedSport)} kin around here yet — clear the filter or share fitkin with your crew.`
          : `no one around here yet — you're first. share fitkin with your crew.`}</p>`;
    if (rows.length) decorateRows(wrap);
  } catch (e) { wrap.innerHTML = `<p class="dimtext">couldn't load the feed — check connection.</p>`; }
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

// 리스트 행에 리뷰 배지 비동기 주입 (recent 50 요약)
async function decorateRows(container) {
  if (!container) return;
  for (const r of [...container.querySelectorAll(".kinrow[data-kin]")].slice(0, 8)) {
    try {
      const sm = await reviewSummary(r.dataset.kin);
      if (!sm.n) continue;
      const p = r.querySelector("p");
      if (p && !p.querySelector(".rvbadge")) {
        const b = document.createElement("span");
        b.className = "rvbadge";
        b.textContent = sm.avg
          ? ` · ★${sm.avg} (${sm.n >= 50 ? "50+" : sm.n})` + (sm.level ? ` · ${sm.level} ✓` : "")
          : " · new kin";
        p.appendChild(b);
      }
    } catch (e) {}
  }
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
    ? kin.map(k => personRow(k, s.sports) +
        `<div style="text-align:right;margin:-6px 0 4px"><button class="chat-act rv-btn"
           data-kin="${esc(k.id)}" data-name="${esc(k.name)}">★ rate</button></div>`).join("")
      + `<p class="dimtext" style="margin-top:8px">tap a kin to message them.</p>`
    : `<p class="dimtext">no kin yet — show your code to someone at the gym.</p>`;
  wrap.querySelectorAll(".kinrow").forEach(r =>
    r.onclick = () => openChat(r.dataset.kin, r.dataset.name));
  // XSS 봉인: 이름을 JS 문자열에 인라인하지 않는다 — data 속성(큰따옴표 esc)만
  wrap.querySelectorAll(".rv-btn").forEach(b =>
    b.onclick = e => { e.stopPropagation(); fitkinReview(b.dataset.kin, b.dataset.name); });
  decorateRows(wrap);
}

// ── 킨 리뷰 (v1.2 · 설계 LOCKED) — 별점 3~5, 긍정 태그, 더블 블라인드 ──
const REVIEW_TAGS = ["on-time", "great-energy", "matched-level", "good-communicator",
                     "would-train-again", "pushes-me", "patient-teacher"];
let rvTarget = null, rvStars = 0, rvTags = [], rvLevel = "";
window.fitkinReview = async function (uid, name) {
  rvTarget = { uid, name }; rvStars = 0; rvTags = []; rvLevel = "";
  $("#rvName").textContent = name;
  $("#rvComment").value = "";
  // 기존 리뷰 로드(수정 모드)
  try {
    await ready;
    const snap = await getDoc(doc(db, "reviews", UID + "_" + uid));
    if (snap.exists()) {
      const d = snap.data();
      rvStars = d.stars; rvTags = d.tags || []; rvLevel = d.levelCheck || "";
      $("#rvComment").value = d.comment || "";
      // 상대가 그새 리뷰했으면 내 잠긴 리뷰를 즉시 공개로 당긴다 (더블 블라인드 완결)
      if (d.visibleAfter > Date.now()) {
        const theirs = await getDoc(doc(db, "reviews", uid + "_" + UID));
        if (theirs.exists()) {
          await updateDoc(doc(db, "reviews", UID + "_" + uid), { visibleAfter: Date.now() });
        }
      }
    }
  } catch (e) {}
  paintReviewSheet();
  $("#review").classList.add("on");
};
window.fitkinReviewClose = function () { $("#review").classList.remove("on"); };
window.fitkinRvStar = function (n) {
  if (n < 3) {
    // 정직한 UX: 나쁜 경험은 별점이 아니라 신고·차단 경로로 (설계 §6-1)
    toast("had a bad experience? use report or block in the chat — reviews here are for kin you'd train with again");
    return;
  }
  rvStars = n; paintReviewSheet();
};
window.fitkinRvTag = function (t) {
  rvTags = rvTags.includes(t) ? rvTags.filter(x => x !== t) : (rvTags.length < 5 ? [...rvTags, t] : rvTags);
  paintReviewSheet();
};
window.fitkinRvLevel = function (l) { rvLevel = rvLevel === l ? "" : l; paintReviewSheet(); };
function paintReviewSheet() {
  $("#rvStars").innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<button class="rvstar${n <= rvStars ? " sel" : ""}" onclick="fitkinRvStar(${n})">★</button>`).join("");
  $("#rvTags").innerHTML = REVIEW_TAGS.map(t =>
    `<button class="fchip${rvTags.includes(t) ? " sel" : ""}" onclick="fitkinRvTag('${t}')">${t.replace(/-/g, " ")}</button>`).join("");
  $("#rvLevels").innerHTML = ["new-ish", "steady", "serious"].map(l =>
    `<button class="fchip${rvLevel === l ? " sel" : ""}" onclick="fitkinRvLevel('${l}')">${l}</button>`).join("");
  $("#rvSubmit").disabled = !rvStars;
}
window.fitkinReviewSubmit = async function () {
  if (!rvTarget || !rvStars) return;
  try {
    await ready;
    if (!UID) { toast("you're offline — try again when you're back"); return; }
    // 상대가 이미 나를 리뷰했으면 즉시 공개, 아니면 14일 블라인드
    let visibleAfter = Date.now() + 1209600000;
    try {
      const theirs = await getDoc(doc(db, "reviews", rvTarget.uid + "_" + UID));
      if (theirs.exists()) visibleAfter = Date.now();
    } catch (e) {}
    const linkId = UID < rvTarget.uid ? UID + "_" + rvTarget.uid : rvTarget.uid + "_" + UID;
    const ref = doc(db, "reviews", UID + "_" + rvTarget.uid);
    const prev = await getDoc(ref);
    if (prev.exists()) {
      await updateDoc(ref, { stars: rvStars, tags: rvTags,
        comment: $("#rvComment").value.trim().slice(0, 140), levelCheck: rvLevel,
        visibleAfter: Math.min(visibleAfter, prev.data().visibleAfter) });
    } else {
      await setDoc(ref, { from: UID, to: rvTarget.uid, linkId, stars: rvStars, tags: rvTags,
        comment: $("#rvComment").value.trim().slice(0, 140), levelCheck: rvLevel,
        ts: Date.now(), visibleAfter });
    }
    fitkinReviewClose();
    toast(visibleAfter <= Date.now()
      ? "review posted ✓"
      : "review saved — it goes live when they review you back, or in 14 days");
  } catch (e) {
    if (String(e.code).includes("permission"))
      toast("reviews open 24h after you become kin — see you tomorrow ✨");
    else toast("couldn't save the review — try again");
  }
};
// 리뷰 요약 조회 (recent 50): 평균★·수·level 분포 — personRow 배지용
async function reviewSummary(uid) {
  try {
    const qs = await getDocs(query(collection(db, "reviews"),
      where("to", "==", uid), where("visibleAfter", "<=", Date.now() - 30000),
      orderBy("visibleAfter", "desc"), limit(50)));
    let sum = 0, n = 0; const lv = {};
    qs.forEach(d => { const r = d.data(); sum += r.stars; n++;
      if (r.levelCheck) lv[r.levelCheck] = (lv[r.levelCheck] || 0) + 1; });
    if (n < 3) return { n, label: n ? "new kin" : "" };   // 3개 미만: 평균 숨김 (설계 §1)
    const top = Object.entries(lv).sort((a, b) => b[1] - a[1])[0];
    return { n, avg: (sum / n).toFixed(1),
      level: top && top[1] >= 3 ? top[0] : null };        // level 배지는 3표+
  } catch (e) { return { n: 0, label: "" }; }
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
  paintAcct();
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
  paintSeek();
  paintKin();
  paintDiscover();
  if (s.pendingKin) { const p = s.pendingKin; delete s.pendingKin; put(s); location.hash = "#kin=" + p; handleKinLink(); }
}

// ── 버디 찾기 노출 토글: 프로필을 지우지 않고 리스트에서만 내린다/올린다 ──
function paintSeek() {
  const row = $("#seekRow"); if (!row) return;
  const s = st();
  row.innerHTML = s.hidden
    ? `you're <b>hidden</b> — no one new can find you. kin you already have keep you. ` +
      `<a href="#" onclick="fitkinSeeking();return false" style="color:var(--mint)">list me again</a>`
    : `you're <b>listed</b> — kin near you can find you. found your buddy? ` +
      `<a href="#" onclick="fitkinSeeking();return false" style="color:var(--mint)">hide me</a>`;
}
window.fitkinSeeking = async function () {
  const s = st();
  s.hidden = !s.hidden; s.published = 0; put(s);
  paintSeek();
  const ok = await window.fitkinPublish();
  if (ok) toast(s.hidden ? "you're off the list 🙈 — come back anytime" : "you're back on the list 👋");
};

function toast(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.className = "show";
  setTimeout(() => t.className = "", 3200);
}

// ── 출장 모드: 현재 지역 빠른 전환 (온보딩 재주행 없이) ──
window.fitkinArea = async function () {
  const s = st();
  const z = prompt("traveling? type your current zip (5 digits) —\nor leave it empty to use your current location\n(we only keep a rough ~5km area, never your exact spot).", s.zip || "");
  if (z === null) return;
  if (z.trim() === "") { window.fitkinUseLocation(true); return; }
  if (!/^[0-9]{5}$/.test(z.trim())) { toast("that's not a 5-digit zip"); return; }
  if (s.homeZip === undefined) s.homeZip = s.zip || "";
  if (s.homeCell === undefined) s.homeCell = s.cell || "";
  s.zip = z.trim(); delete s.cell;   // 출장 ZIP 존에선 홈 셀 매칭이 새면 안 된다
  s.published = 0; put(s);   // 재시도 기계 재장전
  const ok = await window.fitkinPublish();
  if (ok) {
    toast(s.zip === s.homeZip ? "back home 🏠" : "now finding kin in " + s.zip + " ✈️");
    paintDiscover();
    if ($("#feed") && $("#feed").classList.contains("on")) paintFeed();  // 피드에서 전환한 경우
  }
};
window.fitkinAreaHome = async function () {
  const s = st();
  if (s.homeZip === undefined || (s.homeZip === (s.zip || "") && (s.homeCell || "") === (s.cell || ""))) { toast("you're already home 🏠"); return; }
  s.zip = s.homeZip; if (s.homeCell) s.cell = s.homeCell; else delete s.cell;
  delete s.homeZip; delete s.homeCell;
  s.published = 0; put(s);
  const ok = await window.fitkinPublish();
  if (ok) { toast("back home 🏠"); paintDiscover(); }
};

// ── 프로필 완전 삭제 (privacy 약속 이행: 서버 데이터까지 지운다) ──
window.fitkinDelete = async function () {
  if (!confirm("delete your account everywhere? this removes your card, your photos, reviews you wrote, and your sign-in from fitkin's servers and this phone. messages you sent in chats may remain on your kin's side.")) return;
  try {
    await ready;
    // 오프라인이면 삭제를 가장하지 않는다 — 서버까지 지울 수 있을 때만 "deleted"
    if (!UID) { toast("you're offline — try deleting again when you're back online"); return; }
    // ① 내 모먼트 사진 전부 — 페이지 단위로 반복(100장 한도 없음). 하나라도 실패하면
    //    성공을 가장하지 않고 여기서 멈춘다.
    try {
      for (let page = 0; page < 50; page++) {
        const mine = await getDocs(query(collection(db, "photos"),
          where("owner", "==", UID), limit(100)));
        if (mine.empty) break;
        for (const d of mine.docs) await deleteDoc(d.ref);
        if (mine.size < 100) break;
      }
    } catch (ep) { toast("couldn't remove your photos — check connection and try again"); return; }
    // ①-b 내가 쓴 리뷰 청산. 받은 리뷰는 블라인드 규칙상 클라가 열거 불가 —
    //    운영(moderate.py cleanorphans)이 지운다 (고아 리뷰는 to 가 없어 어차피 미표시).
    try {
      for (let page = 0; page < 20; page++) {
        const mine = await getDocs(query(collection(db, "reviews"),
          where("from", "==", UID), limit(100)));
        if (mine.empty) break;
        for (const d of mine.docs) await deleteDoc(d.ref);
        if (mine.size < 100) break;
      }
    } catch (er) { toast("couldn't remove your reviews — check connection and try again"); return; }
    // ② 카드
    await deleteDoc(doc(db, "profiles", UID));
    // ③ Auth 계정(심사 5.1.1(v)) — 오래된 세션이면 그 자리에서 재인증 후 재시도.
    //    실패해도 로그아웃하거나 로컬을 지우지 않는다: 같은 버튼을 다시 누르면
    //    (①②는 no-op) 재인증부터 자연스럽게 재시도된다.
    let authDeleted = true;
    if (auth.currentUser && !auth.currentUser.isAnonymous) {
      try { await deleteUser(auth.currentUser); }
      catch (e2) {
        authDeleted = false;
        if (String(e2.code).includes("requires-recent-login")) {
          try {
            const prov = ((auth.currentUser.providerData || [])[0] || {}).providerId || "";
            const kind = prov.includes("apple") ? "apple" : "google";
            if (nativeSL()) {
              // reauthenticate 는 다른 계정을 고르면 user-mismatch 로 거부한다 — 오삭제 봉인
              await reauthenticateWithCredential(auth.currentUser, await nativeCred(kind));
            } else {
              const provider = kind === "apple" ? new OAuthProvider("apple.com") : new GoogleAuthProvider();
              await reauthenticateWithPopup(auth.currentUser, provider, browserPopupRedirectResolver);
            }
            await deleteUser(auth.currentUser);
            authDeleted = true;
          } catch (e4) {}
        }
      }
    } else if (auth.currentUser) {
      try { await deleteUser(auth.currentUser); } catch (e5) {}
    }
    if (!authDeleted) {
      toast("your card and photos are gone, but we couldn't confirm it's you — tap delete my profile once more to finish");
      return;
    }
    localStorage.removeItem("fitkin");
    toast("deleted. take care out there 💚");
    setTimeout(() => location.reload(), 1200);
  } catch (e) { toast("couldn't reach the server — try again online"); }
};

// 컴플레인·피드백 창구 — 서버 접수함(feedback)으로 직행, 운영자(자비스)가 매일 검토.
window.fitkinFeedback = async function () {
  const text = (prompt("what's going on? bugs, complaints, ideas — we read every message.") || "").trim().slice(0, 1000);
  if (!text) return;
  const contact = (prompt("want a reply? leave an email (optional)") || "").trim().slice(0, 100);
  try {
    await ready;
    if (!UID) { toast("you're offline — try again when you're back"); return; }
    await addDoc(collection(db, "feedback"), {
      by: UID, text, contact,
      app: (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? "ios" : "web",
      ts: Date.now(),
    });
    toast("got it — thank you 💚 we read every message");
  } catch (e) { toast("couldn't send — try again in a moment"); }
};
window.fitkinHome = paintHome;
// 인라인 renderCard 는 번들보다 먼저 실행돼 SVG 아바타를 모른다 — 로드 직후 한 번 재도색
try { if (window.renderCard && st().done) window.renderCard(); } catch (e) {}
handleKinLink();
if (st().done) ready.then(paintHome);
