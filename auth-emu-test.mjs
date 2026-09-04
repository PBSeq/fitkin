// P1 실측: 같은 이메일 Google 계정 존재 상태에서 Apple 로그인 폴백의 종착점
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInAnonymously, signInWithCredential,
         linkWithCredential, GoogleAuthProvider, OAuthProvider, signOut } from "firebase/auth";

const app = initializeApp({ projectId: "demo-fitkin", apiKey: "fake" });
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

const EMAIL = "reviewer@example.com";
const googleTok = JSON.stringify({ sub: "google-uid-1", email: EMAIL, email_verified: true });
const appleTok  = JSON.stringify({ sub: "apple-uid-1",  email: EMAIL, email_verified: true });

const g = await signInWithCredential(auth, GoogleAuthProvider.credential(googleTok));
console.log("① 구글 계정 생성:", g.user.uid);
await signOut(auth);

const anon = await signInAnonymously(auth);
console.log("② 익명:", anon.user.uid);

const appleCred = new OAuthProvider("apple.com").credential({ idToken: appleTok });
try {
  await linkWithCredential(auth.currentUser, appleCred);
  console.log("③ link 성공(!) — 예상 밖");
} catch (e) { console.log("③ link 실패:", e.code); }

try {
  const r = await signInWithCredential(auth, new OAuthProvider("apple.com").credential({ idToken: appleTok }));
  console.log("④ 폴백 signIn 성공 → uid:", r.user.uid, "| providers:", r.user.providerData.map(p=>p.providerId).join(","));
  console.log("   (구글 uid와", r.user.uid === g.user.uid ? "같음 = 기존 계정 접속" : "다름 = 별도 계정", ")");
} catch (e) { console.log("④ 폴백 signIn 실패:", e.code); }
process.exit(0);
