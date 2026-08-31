#!/usr/bin/env python3
"""app/app.js(웹·gstatic CDN판) → app/entry.js(npm 번들 입력) 기계 변환.

변환 규칙 (v1.1 수작업 변환을 diff 로 확정한 것):
  1. 헤더의 gstatic import 3개 → npm 정적 import (심볼 슈퍼셋, AUTH_SYMS/FS_SYMS)
  2. 본문의 `const { X } = await import("gstatic…")` 구조분해 줄 제거
     — X 는 이미 헤더에서 정적 import 되어 있어야 한다 (아니면 여기서 실패시킴)

번들: npx esbuild app/entry.js --bundle --format=iife --minify --outfile=app/bundle.js
"""
import re, sys

AUTH_SYMS = ["initializeAuth", "indexedDBLocalPersistence", "browserLocalPersistence",
             "browserPopupRedirectResolver", "signInAnonymously", "onAuthStateChanged",
             "signInWithCredential", "GoogleAuthProvider", "OAuthProvider", "deleteUser",
             "linkWithCredential", "linkWithPopup", "reauthenticateWithCredential",
             "reauthenticateWithPopup", "signInWithPopup", "signOut"]
FS_SYMS = ["getFirestore", "collection", "doc", "setDoc", "getDoc", "getDocs", "query",
           "where", "orderBy", "limit", "limitToLast", "addDoc", "onSnapshot",
           "deleteDoc", "updateDoc"]

a = open("app/app.js").read()

# 1) 헤더 import 교체
a = re.sub(r'import \{ initializeApp \} from "https://www\.gstatic\.com/[^"]*firebase-app\.js";',
           'import { initializeApp } from "firebase/app";', a)
a = re.sub(r'import \{[^}]*\}\s*\n?\s*from "https://www\.gstatic\.com/[^"]*firebase-auth\.js";',
           'import { %s }\n  from "firebase/auth";' % ", ".join(AUTH_SYMS), a)
a = re.sub(r'import \{[^}]*\}\s*\n?\s*from "https://www\.gstatic\.com/[^"]*firebase-firestore\.js";',
           'import { %s }\n  from "firebase/firestore";' % ", ".join(FS_SYMS), a)

# 2) 동적 import 구조분해 제거 — 심볼이 슈퍼셋에 없으면 중단
known = set(AUTH_SYMS + FS_SYMS)
for m in re.finditer(r'const \{([^}]*)\}\s*=\s*\n?\s*await import\("https://www\.gstatic\.com/[^"]*"\);', a):
    syms = [s.strip() for s in m.group(1).split(",") if s.strip()]
    missing = [s for s in syms if s not in known]
    if missing:
        sys.exit("중단: 동적 import 심볼이 헤더 슈퍼셋에 없음 → %s (make_entry.py 의 *_SYMS 에 추가하라)" % missing)
a = re.sub(r'[ \t]*const \{[^}]*\}\s*=\s*\n?\s*await import\("https://www\.gstatic\.com/[^"]*"\);\n', "", a)

if "gstatic" in a:
    sys.exit("중단: 변환 후에도 gstatic 참조 잔존 — 새 패턴이 생겼다, 스크립트를 갱신하라")

open("app/entry.js", "w").write(a)
print("entry.js 재생성 완료 (%d bytes)" % len(a))
