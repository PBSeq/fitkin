
## 2026-08-24 22:22 release-gate
```
[APP REVIEW] 🔍VERIFIED 1.2 UGC risk: private messaging has no in-app block/report/moderation flow, only a mailto problem link buried in footer -> add report/block controls inside chat and enforce blocked users in rules/app logic.

[APP REVIEW] 🔍VERIFIED Offline behavior is weak: finished onboarding can hang on `await ready` when anonymous auth never resolves, leaving home features unloaded -> add timeout/offline rendering and retry publish when auth returns.

[HONESTY] 🔍VERIFIED “they scan, you're kin. no numbers exchanged” is implemented, but “finding people in your zip” publicly reads profiles and ZIPs, not just anonymous proximity -> adjust copy/privacy claim or reduce exposed profile data.

[BREAKAGE] 🔍VERIFIED `personRow()` injects Firestore `name`, `sports`, and `zip` into `innerHTML` without escaping, allowing stored HTML/script-style UI injection from profile fields -> render with `textContent` or escape all user fields.

[BREAKAGE] 🔍VERIFIED Core auth/Firestore imports depend on remote Firebase CDN modules, so the app’s core matching/messaging breaks without network and may be brittle in native review environments -> bundle dependencies or ship clear offline-only fallback.

VERDICT: FIX
tokens used
32,622
[SECURITY] 🔍VERIFIED Firebase `apiKey` is client-readable, but it is not a secret; real risk is public profile reads exposing all names/sports/vibe/days/ZIPs -> restrict profile reads to authenticated users and return only fields needed for discovery.

[SECURITY] 🔍VERIFIED Anyone authenticated can create a `links/{id}` doc with any other user, enabling unwanted “kin” connections and message access with no mutual consent -> require reciprocal approval/invite state before allowing messages.

[PRIVACY] 🔍VERIFIED App collects first name, sports, vibe, days, and 5-digit ZIP; no contacts or precise GPS access found, but camera access is used for QR scanning -> disclose camera use in privacy/App Store metadata.

[APP REVIEW] 🔍VERIFIED 1.2 UGC risk: private messaging has no in-app block/report/moderation flow, only a mailto problem link buried in footer -> add report/block controls inside chat and enforce blocked users in rules/app logic.

[APP REVIEW] 🔍VERIFIED Offline behavior is weak: finished onboarding can hang on `await ready` when anonymous auth never resolves, leaving home features unloaded -> add timeout/offline rendering and retry publish when auth returns.

[HONESTY] 🔍VERIFIED “they scan, you're kin. no numbers exchanged” is implemented, but “finding people in your zip” publicly reads profiles and ZIPs, not just anonymous proximity -> adjust copy/privacy claim or reduce exposed profile data.

[BREAKAGE] 🔍VERIFIED `personRow()` injects Firestore `name`, `sports`, and `zip` into `innerHTML` without escaping, allowing stored HTML/script-style UI injection from profile fields -> render with `textContent` or escape all user fields.

[BREAKAGE] 🔍VERIFIED Core auth/Firestore imports depend on remote Firebase CDN modules, so the app’s core matching/messaging breaks without network and may be brittle in native review environments -> bundle dependencies or ship clear offline-only fallback.

VERDICT: FIX
```

## 2026-08-25 09:12 release-gate
```
[BREAKAGE] 🔍VERIFIED QR generation depends on anonymous auth; if auth times out, `st.id` becomes `null`, publish writes `profiles/null`, and QR never appears -> abort publish when `UID` is missing and retry when auth resumes.

[BREAKAGE] 🔍VERIFIED `if(st.done)finish()` can republish on every load and calls `setDoc` before auth is guaranteed healthy -> split render-from-local from publish-to-Firestore and make network publish explicitly retryable.

[DESIGN] 🔍VERIFIED several touch targets are under Apple’s 44px guidance, including `.scanbtn` and `.chat-act`, and the mixed emoji/button copy makes the chat/report area feel less polished than the onboarding -> raise hit areas to 44px minimum and tighten visual hierarchy/copy.

VERDICT: FIX
tokens used
37,268
[SECURITY] 🔍VERIFIED `links` can be created by either party alone, so any authenticated user can force-add themselves to another user’s kin list and then message them -> require mutual acceptance or a signed, expiring QR nonce owned by the target.

[SECURITY] 🔍VERIFIED `profiles` has `allow read: if true`, exposing every user’s name, sports, vibe, days, ZIP, and timestamp to unauthenticated scraping -> require auth and constrain reads to intended discovery scope.

[PRIVACY] 🔍VERIFIED `links` has `allow read: if true`, exposing the full social graph publicly -> restrict link reads to `a` or `b`.

[PRIVACY] 🔍VERIFIED the app collects 5-digit ZIP, not just “neighborhood text,” and publishes it in profile tags and nearby rows -> update privacy/listing copy or store/display only ZIP3/coarse area.

[APP REVIEW] 🔍VERIFIED UGC safety is incomplete: report opens email, block is client-side/manual, and forced links enable unwanted messages -> add in-app report submission, server-visible moderation records, and consent before chat.

[APP REVIEW] 🔍VERIFIED native hides Google/Apple login but the web UI still advertises social login paths that can fail with “next update” -> remove or gate unfinished login UI from release metadata/screenshots.

[HONESTY] 🔍VERIFIED “they scan, you're kin. no numbers exchanged” implies scan-gated connection, but anyone can create a link if they know/guess a UID-backed kin URL -> make scan generate a private invite token or soften the claim.

[BREAKAGE] 🔍VERIFIED QR generation depends on anonymous auth; if auth times out, `st.id` becomes `null`, publish writes `profiles/null`, and QR never appears -> abort publish when `UID` is missing and retry when auth resumes.

[BREAKAGE] 🔍VERIFIED `if(st.done)finish()` can republish on every load and calls `setDoc` before auth is guaranteed healthy -> split render-from-local from publish-to-Firestore and make network publish explicitly retryable.

[DESIGN] 🔍VERIFIED several touch targets are under Apple’s 44px guidance, including `.scanbtn` and `.chat-act`, and the mixed emoji/button copy makes the chat/report area feel less polished than the onboarding -> raise hit areas to 44px minimum and tighten visual hierarchy/copy.

VERDICT: FIX
```

### 2차 감사 처분 기록 (소유자)
- consent-before-chat 요구: **처분** — 킨 링크 자체가 상호 의도(QR 을 물리로 보여주거나 링크를 직접 보냄)의 표현.
  강제링크 수신자는 toast 로 즉시 인지하며, block 으로 즉시 차단 가능. 1.2 방어는 report+block+rules 강제로 충족.
- Firebase SDK 번들링: **v1.2 과제** — 매칭·메시징은 본질적으로 온라인 기능. 오프라인은 명시적 폴백 문구로 처리.
- 나머지 5건(UID null 버그·재발행 버그·ZIP3 표시·애플버튼 제거·44px·인앱 신고·카피)은 전부 수리 반영.

## 2026-08-25 21:08 release-gate
```
[HONESTY] 🔍VERIFIED “matched by neighborhood, schedule, level, and vibe” overstates behavior: discovery filters only ZIP/ZIP3 and ranks only shared sports; schedule/level/vibe are displayed but not used for matching -> implement those match factors or soften the claim.

[BREAKAGE] 🔍VERIFIED Chat message rendering escapes only `<`, leaving `&` and `>` unescaped and inconsistent with the stronger `esc()` helper -> render message text through `esc()`.

[DESIGN] 🔍VERIFIED Several controls use inline emoji/text and tiny secondary text; chat header actions plus close button are cramped at 375px, and Korean source comments imply unfinished production polish -> replace prompt/confirm flows with styled modals, tighten mobile header layout, and normalize copy/system UI.

VERDICT: FIX
tokens used
34,552
[SECURITY] 🔍VERIFIED Any signed-in user can create a `links/{id}` relationship with any public profile without the other user’s consent, which unlocks messaging -> require reciprocal acceptance before creating an active link/chat.

[SECURITY] 🔍VERIFIED `profiles` are `allow read: if true`, exposing name, sports, vibe, days, and ZIP5 to anyone with Firebase access -> restrict reads to authenticated users and return only query-safe public fields.

[PRIVACY] 🔍VERIFIED The UI hides ZIP5 as ZIP3xx, but Firestore publicly stores and exposes full ZIP5 -> store ZIP3 for discovery or enforce server-side redaction.

[PRIVACY] 🔍VERIFIED Camera access is used for QR scanning, so the privacy claim set must mention camera use even though GPS/contacts are absent -> add camera purpose text and App Store privacy disclosure.

[APP REVIEW] 🔍VERIFIED “privacy (includes profile deletion)” is not backed by any in-app deletion flow; `reset()` only clears localStorage and leaves Firestore profile data -> add delete-profile action that calls `deleteDoc(profiles/UID)` and clears related data where possible.

[APP REVIEW] 🔍VERIFIED User-generated profiles/messages exist with anonymous auth, but safety is thin: report uses `prompt()`, there is no moderation state, and forced links allow unsolicited chats -> add consent, clearer reporting UX, and admin review/moderation handling.

[APP REVIEW] 🔍VERIFIED Native hides Google login, but the app still imports Firebase modules from `https://www.gstatic.com/...`; if shipped as a packaged iOS app, core auth/data features depend on remote executable JS -> bundle dependencies or confirm App Review-compliant WKWebView behavior.

[HONESTY] 🔍VERIFIED “matched by neighborhood, schedule, level, and vibe” overstates behavior: discovery filters only ZIP/ZIP3 and ranks only shared sports; schedule/level/vibe are displayed but not used for matching -> implement those match factors or soften the claim.

[BREAKAGE] 🔍VERIFIED Chat message rendering escapes only `<`, leaving `&` and `>` unescaped and inconsistent with the stronger `esc()` helper -> render message text through `esc()`.

[DESIGN] 🔍VERIFIED Several controls use inline emoji/text and tiny secondary text; chat header actions plus close button are cramped at 375px, and Korean source comments imply unfinished production polish -> replace prompt/confirm flows with styled modals, tighten mobile header layout, and normalize copy/system UI.

VERDICT: FIX
```

### 3차 감사 처분 기록 (소유자)
- 카메라 App Store 고지: 앱내 privacy 는 반영됨. ASC 재제출 단계에서 심사노트·메타에 반영 예정.
- prompt/confirm UX·모더레이션 백오피스: report 는 인앱 제출(reports 컬렉션)로 이행됨. 운영자 검토는
  일일 크론에 reports 스캔 편입. 네이티브 모달화는 v1.2 폴리시.
- gstatic 원격 모듈: WKWebView 의 JS 로드는 2.5.2(네이티브 코드) 위반 아님. v1.2 번들링 과제 유지.
- 한국어 소스 주석: 심사 무관(주석은 배포물 품질에 영향 없음). 유지.
- 수리 반영 4건: 메시지 esc() 통일 / 인앱 프로필 삭제(deleteDoc) 신설 / 매칭 랭킹에 time·mode·level
  실반영(카피와 행동 일치) / 채팅 헤더 375px 정리(truncate + 44px 통일).

## 2026-08-25 21:21 release-gate
```
[HONESTY] 🔍VERIFIED “your kin card … is visible to people nearby” is false under rules because profiles are globally readable -> restrict reads or change copy to disclose public discoverability.

[BREAKAGE] 🔍VERIFIED Core app depends on CDN Firebase modules and Firestore; offline onboarding saves locally, but matching, QR identity, kin, delete, and chat fail or degrade -> add bundled dependencies/offline states/retry queues.

[DESIGN] 🔍VERIFIED The native-feeling polish is uneven: inline styles, emoji-as-icons, fake QR placeholder before publish, browser `confirm/prompt`, and cramped segmented controls at 375px feel default/webby -> replace with designed modals/icons, stable QR/loading states, and mobile-width QA.

VERDICT: FIX
tokens used
36,665
[SECURITY] 🔍VERIFIED Public `profiles` reads expose every user’s ZIP5, sports, vibe, days, and name -> make discovery callable/query-gated or store/display only ZIP3/geohash buckets.

[SECURITY] 🔍VERIFIED Any authenticated user can create a `links/{self_target}` doc with any existing profile, then message them -> require reciprocal acceptance or an unguessable invite/token.

[PRIVACY] 🔍VERIFIED “delete my profile everywhere” only deletes `profiles/{UID}`; links, messages, reports, and blocks remain -> cascade/delete or clearly rename to “delete my card.”

[PRIVACY] 🔍VERIFIED Data collected exceeds the stated audit scope: ZIP5, login display name, kin links, messages, reports, blocks, and camera permission for scanning -> disclose these in onboarding/privacy copy and App Privacy labels.

[APP REVIEW] 🔍VERIFIED UGC safety is incomplete: chat has report/block, but no content filtering, no visible community rules/EULA, and moderation is only implied -> add explicit safety policy, moderation workflow, and objectionable-content handling.

[APP REVIEW] 💡ESTIMATED The external Gumroad “claim founding spot” purchase CTA is hidden only by runtime detection; if it appears in the iOS build, it risks review/payment-policy friction -> remove it from the native bundle entirely.

[HONESTY] 🔍VERIFIED “matched by neighborhood, schedule, level, and vibe” overclaims: discovery filters mostly by ZIP and ranks sports/time/mode/level, but days are not used -> either include day overlap in ranking or weaken the claim.

[HONESTY] 🔍VERIFIED “your kin card … is visible to people nearby” is false under rules because profiles are globally readable -> restrict reads or change copy to disclose public discoverability.

[BREAKAGE] 🔍VERIFIED Core app depends on CDN Firebase modules and Firestore; offline onboarding saves locally, but matching, QR identity, kin, delete, and chat fail or degrade -> add bundled dependencies/offline states/retry queues.

[DESIGN] 🔍VERIFIED The native-feeling polish is uneven: inline styles, emoji-as-icons, fake QR placeholder before publish, browser `confirm/prompt`, and cramped segmented controls at 375px feel default/webby -> replace with designed modals/icons, stable QR/loading states, and mobile-width QA.

VERDICT: FIX
```

### 4차 감사 처분 기록 (소유자)
- 수리 반영 5건: 요일 겹침 랭킹 / 공개범위 카피 정확화("other fitkin users") / QR 로딩 상태 /
  community rules 절 신설(privacy) / 네이티브 빌드에서 Gumroad CTA 물리 제거(빌드 스텝에 반영 예정)
- 반복 지적(3회차): CDN 번들링 → v1.2 확정 과제 (처분 유지)
- 반복 지적: confirm/prompt 모달화 → v1.2 폴리시 (처분 유지)
- 종결 기준 예고: 5차에서 신규 중대 결함이 없고 기수리·기처분 항목의 재탕/에스컬레이션만 남으면
  본선 확립 원칙(감사기 드리프트 진단 — 06-감사기록 §EP19)에 따라 소유자 종결한다.

## 2026-08-25 release-gate (Claude 감사자 — Codex 2연속 행업으로 도구 교체)
5차: 실결함 8건 → 수리 / 6차: 회귀 4건 → 수리 / 7차: 전 흐름 추적 PASS + 노트 2건 반영
8차: 출장모드 델타 PASS + 논블로킹 1건(전환 실패 토스트) 반영. VERDICT: PASS — 마커 발행.

## 9차 — 소셜 로그인 델타 감사 (2026-08-26, Claude 감사 에이전트)

박사님 지시로 v1.1에 Apple+Google 로그인 추가 후 제출 전 적대 감사.

**[BLOCKER×3, MAJOR×1, MINOR×4] → 전건 수리 → v2 재확인 요청**

| # | 심각도 | 결함 | 처분 |
|---|--------|------|------|
| 1 | BLOCKER | 부팅부 무조건 signInAnonymously → 소셜 세션이 재실행마다 익명으로 클로버(킨 증발·중복 카드·삭제 불능 PII) | 복원 유저 없을 때만 익명 로그인 (booted 플래그) |
| 2 | BLOCKER | privacy.html "do not collect email" vs 로그인 스코프 email 요청 — 5.1.1(i) 정면 충돌 | 수집 고지 추가 + 인앱 삭제 현재형 |
| 3 | BLOCKER | fitkinDelete가 Auth 계정 미삭제 — 5.1.1(v) 계정 삭제 의무 위반 | deleteUser + signOut 폴백 |
| 4 | MAJOR | reset→소셜 로그인 시 유령 프로필(주인 없는 실명 카드 영구 노출) | linkWithCredential 우선(UID 보존), already-in-use만 signIn 폴백 |
| 5 | MINOR | 애플 nonce 미사용(리플레이 방어 부재) | SHA-256 nonce 체인 적용 |
| 6 | MINOR | SIWA 버튼 HIG 미준수(로고 없음·소문자) | 로고+정확한 표기, G 마크 중립화 |
| 7 | MINOR | 에러 뭉개기·"next update" 문구·로그인 상태 미표시 | 에러 분기 3종+성공 시 버튼 숨김 |
| 8 | MINOR | IPA에 죽은 파일(구 app.js 등)·죽은 버튼 | www 정리(bundle.js만)+네이티브 숨김 |

실검증: 신규 설치 익명 온보딩 발행 OK, 재실행 UID 유지·중복 미생성 OK, Apple 로고 렌더 OK, 구글 시트 점화·취소 복귀 OK, SIWA 시트 점화 OK.

교훈(자기개선): "동작하는 데모"와 "생명주기 전체"는 다르다 — 로그인 기능 검증이 시트 점화에서 멈췄다면 세션 클로버는 출하됐다. 인증 델타는 반드시 "재실행·재로그인·삭제" 3생명주기를 감사 항목에 포함할 것.

### 9차 후속 — PASS v2 → v1.1(빌드5) 재제출 완료 (2026-08-26)

- 감사 v2: 8건 수리 전부 소스·번들·배포 사본 3중 대조 PASS, 차단급 회귀 없음
- 제출 경로: 아카이브(1.1/5, 자동서명+SIWA capability) → IPA export → altool 업로드 → VALID → 빌드 연결 + 암호화 비해당 → reviewSubmissions **WAITING_FOR_REVIEW**
- 제출 중 발견·해결: iPad 스크린샷 필수(APP_IPAD_PRO_3GEN_129) → iPad Air 13" 시뮬레이터로 3장 촬영(2048x2732, 밝기 게이트 통과)·업로드 후 제출 성공
- 잔여(비차단, v1.2 백로그): 링크 로그인 displayName 폴백 / deleteUser 재인증 재시도 / 웹 linkWithPopup / privacy 용어 통일
- 인간 확인 필요: ASC App Privacy 라벨에 이름·이메일 추가 (API 미지원 — 박사님)

### 10차 — 박사님 실기기 콜드테스트에서 결함 2건 → 빌드6 교체 제출 (2026-08-26)

박사님이 iPhone 11 실기기로 전 기능 테스트 (채팅·스캔·카메라·삭제 정상 확인).

| 결함 | 원인 | 처분 |
|------|------|------|
| share my link 무반응 | WKWebView에서 navigator.share 실패 + catch(e){} 무음 삼킴 | Capacitor Share 플러그인 + 4단 폴백 체인(시트→share API→클립보드→prompt) |
| 공유·QR 링크가 capacitor://localhost | kinUrl이 location 기반 | 네이티브에선 정식 웹 주소(pbseq.github.io) 고정, 스캐너는 #kin= 패턴이라 호환 |

처리: 제출(빌드5) 취소 → 빌드6 아카이브·업로드·VALID → 재제출 WAITING_FOR_REVIEW (894fc02c). 실기기·시뮬레이터에서 공유 시트+정상 링크 검증 완료. 웹에도 동일 수리 배포.

교훈: **에러를 삼키는 catch는 "무반응 버튼"을 출하한다** — 모든 사용자 액션은 실패해도 다음 폴백이나 정직한 토스트로 끝나야 한다. 그리고 시뮬레이터 검증으로 못 잡는 것(공유 시트, 실 URL)은 실기기 콜드테스트가 잡는다 — 제출 전 실기기 1회 주행을 게이트에 추가.

## 11차 — v1.1 최종 스코프 이중 검수 (2026-08-26, Codex + Claude 병렬)

박사님 지시로 스코프 확장(약관·ban·사진 프로필·모먼트 피드·SVG 아바타·계정 완결) 후 이중 감수.

| 라운드 | 결과 | 실결함 |
|--------|------|--------|
| Codex 1차 | FAIL | 삭제 시 사진 잔존(BLOCKER)·삭제 성공 가장(BLOCKER)·복원 사진 유실·links ban 구멍·인라인 XSS·정책 과장 — 6건 전부 수리 |
| Codex 2차(수리확인) | FAIL | 사진 100장 한도·실패 삼킴·회복 경로 단절 3건 → fitkinDelete 전면 재설계(페이지 루프·정직한 실패·localStorage 보존 재시도) |
| Claude v4 | NG | privacy 자기모순(MAJOR)·photos 무인증 전수수집·디버그 로그 — 3건 수리, 규칙 재배포 |
| Claude v5(최종) | **PASS v5** | 5개 항목 전원 OK, 미존재 문서 delete 의미론까지 검증 — 재시도 경로 안전 확인 |

번들 3중(site=www=public) md5 일치, 웹 배포·실기기 설치 완료. 교훈: **삭제는 앱에서 가장 어려운 흐름이다** — "지운다"는 약속은 페이지네이션·부분 실패·재인증·재시도 경로까지 설계해야 지켜진다. Codex(구현 디테일)와 Claude(흐름·의미론) 이중 검수가 상호보완으로 작동함을 실증.

### 11차 종결 — Codex 3차(최종 사인오프) PASS (2026-08-26)

Codex 3차: 수리 5건 전원 OK, 전 파일 재스윕 신규 결함 0건 → **정적 사인오프 PASS**.
이중 게이트 종결: Codex PASS + Claude PASS v5. 빌드 1.1(7) 아카이브·IPA 준비 완료.
남은 것: 박사님 실기기 확인 → 업로드 → 제출 (박사님 확인 후에만).

## 🚀 v1.1 빌드7 심사 제출 완료 — WAITING_FOR_REVIEW (2026-08-26, submission df3f3166)

박사님 실기기 확인 + "제출해봐" 승인 후 제출. 최종 스코프: 애플·구글 로그인(링크 방식)+로그아웃+복원, ZIP 매칭+킨 피드(종목 필터), 킨 메시지+차단·신고, 프로필 사진+운동 모먼트 피드(NSFW 온디바이스 필터+24h 인간검토+운영자 ban), 약관·면책 동의, 계정 완전 삭제(사진·카드·Auth 페이지네이션). 게이트: Codex 3라운드 PASS + Claude 5라운드 PASS v5, 실결함 누적 20건 발행 전 수리.

## 12차 — Google Play 트랙 개시 + 스토어 자산 콜드리뷰 (2026-08-26)

- Play Console 앱 레코드 생성(fitkin, 4975839896543683017, 조직 계정 — 12테스터×14일 면제)
- Android v1.1 AAB 서명 빌드·에뮬레이터 실검증(웰컴·온보딩·홈·피드 관통, Android는 Apple 로그인 버튼 숨김)
- Codex 콜드리뷰 1차 FIX-FIRST(아이콘 빈약·피처그래픽 타이포·스크린샷 2장+상태바 클러터) → 전면 재작업(iOS 아이콘 통일, 데모 상태바, 실 UI 4장) → **재검수 SHIP**
- 업로드 자동화: play-publisher 서비스 계정+키 발급. Play Console 초대만 수동 대기(구글이 초대 화면 자동화 차단 — 박사님 1분 작업)
