// NSFW 검사 전용 지연 로드 번들 — 사진 업로드 시에만 script 주입으로 로드된다.
// mobilenet_v2 만 인라인 (inception 29MB 배제).
import { load } from "nsfwjs/core";
import { MobileNetV2Model } from "nsfwjs/models/mobilenet_v2";
import * as tf from "@tensorflow/tfjs";
window.__nsfw = { load, MobileNetV2Model, tf };
