// 사진·영상 API 입력 검증 (순수 함수). 파일명이 _ 로 시작해 API 경로로 노출되지 않습니다.
// 제한값(LIMITS)은 브라우저와 같은 assets/photo-core.js 를 그대로 씁니다.
const PhotoCore = require('../assets/photo-core.js');
const TripPlaces = require('../assets/places.js');

const { LIMITS } = PhotoCore;

const MEDIA_TYPES = ['image', 'video'];
const TAKEN_AT_SOURCES = ['exif', 'file', 'upload', 'manual'];
const LOCATION_SOURCES = ['exif', 'preset', 'manual'];
const CAMERA_STRING_KEYS = ['make', 'model', 'lens'];
const CAMERA_NUMBER_KEYS = ['focalLength', 'focal35', 'iso', 'exposureTime', 'fNumber', 'exposureBias'];

/** https://<store>.public.blob.vercel-storage.com/... 형태만 허용 (임의 URL 저장 방지). */
function isBlobUrl(value) {
  if (typeof value !== 'string') return false;
  let u;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && /\.blob\.vercel-storage\.com$/.test(u.hostname);
}

function toInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** ISO 문자열로 정규화. 비어 있으면 null, 잘못된 값이면 NaN 표시용 undefined. */
function toIsoOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** 위도·경도 쌍 검증. 둘 다 비었으면 { lat: null, lng: null }. */
function parseLatLng(latRaw, lngRaw) {
  const lat = toNumberOrNull(latRaw);
  const lng = toNumberOrNull(lngRaw);
  if (lat === null && lng === null) return { lat: null, lng: null };
  if (lat === null || lng === null) return { error: '위도와 경도는 함께 입력해야 해요.' };
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    return { error: '위치 좌표가 올바르지 않아요.' };
  }
  return { lat, lng };
}

function parsePlaceName(raw) {
  const clean = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!clean) return { value: null };
  if (clean.length > LIMITS.placeNameMax) {
    return { error: `장소 이름은 ${LIMITS.placeNameMax}자 이하로 입력해 주세요.` };
  }
  return { value: clean };
}

function parseDay(raw) {
  const day = toInt(raw);
  if (day === null) return { value: null };
  if (!(day >= 1 && day <= LIMITS.tripDays)) return { error: '일차가 올바르지 않아요.' };
  return { value: day };
}

/** 카메라 정보는 알려진 키만, 짧은 문자열/유한한 숫자만 남깁니다. */
function sanitizeCamera(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of CAMERA_STRING_KEYS) {
    if (typeof raw[key] === 'string' && raw[key].trim()) out[key] = raw[key].trim().slice(0, 80);
  }
  for (const key of CAMERA_NUMBER_KEYS) {
    const n = Number(raw[key]);
    if (raw[key] !== null && raw[key] !== undefined && raw[key] !== '' && Number.isFinite(n)) out[key] = n;
  }
  if (typeof raw.flash === 'boolean') out.flash = raw.flash;
  return Object.keys(out).length ? out : null;
}

/** 촬영 시각 → n일차 (여행 첫날 기준, 한국 시간). 모르면 null. */
function dayFromTakenAt(takenAt, tripStartDate) {
  const start = tripStartDate === undefined ? TripPlaces.TRIP_START_DATE : tripStartDate;
  return PhotoCore.suggestDay(takenAt, start, LIMITS.tripDays);
}

/**
 * POST /api/photos 본문 검증. { value } 또는 { error }.
 * 일차를 고르지 않았으면 촬영 날짜로 정합니다.
 */
function parsePhoto(body, opts) {
  const b = body || {};
  const tripStartDate = opts && opts.tripStartDate;

  const uploaderId = toInt(b.uploaderId);
  if (!Number.isInteger(uploaderId)) return { error: '올린 사람을 선택해 주세요.' };

  const mediaType = b.mediaType || 'image';
  if (!MEDIA_TYPES.includes(mediaType)) return { error: '사진 또는 영상만 올릴 수 있어요.' };

  if (!isBlobUrl(b.url) || !isBlobUrl(b.thumbUrl)) {
    return { error: '업로드된 파일 주소가 올바르지 않아요.' };
  }

  const width = toInt(b.width);
  const height = toInt(b.height);
  if (Number.isNaN(width) || Number.isNaN(height)) return { error: '크기 정보가 올바르지 않아요.' };

  const durationSec = toNumberOrNull(b.durationSec);
  if (Number.isNaN(durationSec) || (durationSec !== null && durationSec < 0)) {
    return { error: '영상 길이가 올바르지 않아요.' };
  }
  if (durationSec !== null && durationSec > LIMITS.videoMaxSec + 0.5) {
    return { error: `영상은 ${LIMITS.videoMaxSec}초 이하만 올릴 수 있어요.` };
  }

  const caption = PhotoCore.validateCaption(b.caption);
  if (caption.error) return { error: caption.error };

  const day = parseDay(b.day);
  if (day.error) return { error: day.error };

  const takenAt = toIsoOrNull(b.takenAt);
  if (takenAt === undefined) return { error: '촬영 시각이 올바르지 않아요.' };
  let takenAtSource = null;
  if (takenAt !== null) {
    takenAtSource = TAKEN_AT_SOURCES.includes(b.takenAtSource) ? b.takenAtSource : 'upload';
  }

  const loc = parseLatLng(b.lat, b.lng);
  if (loc.error) return { error: loc.error };
  const place = parsePlaceName(b.placeName);
  if (place.error) return { error: place.error };
  let locationSource = null;
  if (loc.lat !== null) {
    locationSource = LOCATION_SOURCES.includes(b.locationSource) ? b.locationSource : 'exif';
  } else if (place.value !== null) {
    locationSource = LOCATION_SOURCES.includes(b.locationSource) ? b.locationSource : 'manual';
  }

  // 파일에서 읽은 값만 "원본"으로 남겨 나중에 '원래대로' 되돌릴 수 있게 합니다.
  const fromFile = takenAtSource && takenAtSource !== 'manual';
  const locFromFile = locationSource === 'exif';

  return {
    value: {
      uploaderId,
      mediaType,
      url: b.url,
      thumbUrl: b.thumbUrl,
      width,
      height,
      durationSec,
      caption: caption.value,
      day: day.value !== null ? day.value : dayFromTakenAt(takenAt, tripStartDate),
      takenAt,
      takenAtSource,
      lat: loc.lat,
      lng: loc.lng,
      placeName: place.value,
      locationSource,
      originalTakenAt: fromFile ? takenAt : null,
      originalTakenAtSource: fromFile ? takenAtSource : null,
      originalLat: locFromFile ? loc.lat : null,
      originalLng: locFromFile ? loc.lng : null,
      camera: sanitizeCamera(b.camera),
    },
  };
}

// 기기 시계 차이를 감안해 "미래"는 10분 이후부터로 봅니다.
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * PATCH /api/photos 본문 → 수정 후의 전체 값(캡션·일차·시간·위치).
 * current 는 mapPhotoRow() 결과. 본문에 없는 항목은 지금 값을 그대로 둡니다.
 * reset: ['time'] / ['location'] 이면 파일에서 읽은 원본 값으로 되돌립니다.
 * 촬영 시각이 바뀌었는데 일차를 따로 보내지 않았으면, 새 날짜의 일차로 옮깁니다(여행 기간 밖이면 그대로).
 */
function parsePhotoPatch(body, current, nowMs, opts) {
  const tripStartDate = opts && opts.tripStartDate;
  const b = body || {};
  const cur = current || {};
  const original = cur.original || {};
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const reset = Array.isArray(b.reset) ? b.reset : [];

  const travelerId = toInt(b.travelerId);
  if (!Number.isInteger(travelerId)) return { error: '여행자 id가 필요합니다.' };

  const next = {
    caption: cur.caption === undefined ? null : cur.caption,
    day: cur.day === undefined ? null : cur.day,
    takenAt: cur.takenAt || null,
    takenAtSource: cur.takenAtSource || null,
    lat: cur.lat === undefined ? null : cur.lat,
    lng: cur.lng === undefined ? null : cur.lng,
    placeName: cur.placeName === undefined ? null : cur.placeName,
    locationSource: cur.locationSource || null,
  };

  if (has(b, 'caption')) {
    const caption = PhotoCore.validateCaption(b.caption);
    if (caption.error) return { error: caption.error };
    next.caption = caption.value;
  }

  if (has(b, 'day')) {
    const day = parseDay(b.day);
    if (day.error) return { error: day.error };
    next.day = day.value;
  }

  if (reset.includes('time')) {
    next.takenAt = original.takenAt || null;
    next.takenAtSource = next.takenAt ? (original.takenAtSource || 'upload') : null;
  } else if (has(b, 'takenAt')) {
    const t = toIsoOrNull(b.takenAt);
    if (!t) return { error: '촬영 시각이 올바르지 않아요.' };
    if (Date.parse(t) > now + FUTURE_TOLERANCE_MS) return { error: '촬영 시각이 미래일 수는 없어요.' };
    next.takenAt = t;
    next.takenAtSource = 'manual';
  }

  if (!has(b, 'day') && next.takenAt !== (cur.takenAt || null)) {
    const moved = dayFromTakenAt(next.takenAt, tripStartDate);
    if (moved !== null) next.day = moved;
  }

  if (reset.includes('location')) {
    const hasOriginal = original.lat !== null && original.lat !== undefined;
    next.lat = hasOriginal ? original.lat : null;
    next.lng = hasOriginal ? original.lng : null;
    next.locationSource = hasOriginal ? 'exif' : null;
    next.placeName = null;
    if (hasOriginal && has(b, 'placeName')) {
      const place = parsePlaceName(b.placeName);
      if (place.error) return { error: place.error };
      next.placeName = place.value;
    }
  } else if (has(b, 'lat') || has(b, 'lng') || has(b, 'placeName')) {
    if (has(b, 'lat') || has(b, 'lng')) {
      const loc = parseLatLng(b.lat, b.lng);
      if (loc.error) return { error: loc.error };
      next.lat = loc.lat;
      next.lng = loc.lng;
    }
    if (has(b, 'placeName')) {
      const place = parsePlaceName(b.placeName);
      if (place.error) return { error: place.error };
      next.placeName = place.value;
    }
    if (next.lat === null && next.placeName === null) next.locationSource = null;
    else next.locationSource = b.locationSource === 'preset' ? 'preset' : 'manual';
  }

  return { value: next, travelerId };
}

const UPLOAD_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
];

/**
 * 브라우저 직접 업로드용 토큰 규칙. photos/ 폴더 안, 이미지·영상, 용량 제한만 허용합니다.
 * (이미지는 브라우저에서 JPEG 로 줄여 올리므로 HEIC 원본은 올라오지 않습니다.)
 */
function assertUploadPath(pathname) {
  const p = String(pathname || '');
  if (!/^photos\/[A-Za-z0-9._\-/]+$/.test(p) || p.includes('..')) {
    throw new Error('허용되지 않은 업로드 경로입니다.');
  }
  return p;
}

function uploadTokenOptions(pathname) {
  assertUploadPath(pathname);
  return {
    allowedContentTypes: UPLOAD_CONTENT_TYPES,
    maximumSizeInBytes: LIMITS.videoMaxBytes,
    addRandomSuffix: true,
  };
}

/**
 * OIDC(presigned) 업로드용 서명 범위. 서명을 이 경로 하나·put 하나로 좁히므로 경로를 바꾸는
 * 무작위 접미사는 붙이지 않습니다 (경로에 이미 시각 + 무작위 문자열이 들어 있어요).
 */
function presignedUploadOptions(pathname, nowMs) {
  const p = assertUploadPath(pathname);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const limits = { allowedContentTypes: UPLOAD_CONTENT_TYPES, maximumSizeInBytes: LIMITS.videoMaxBytes };
  return {
    signed: { pathname: p, operations: ['put'], validUntil: now + 60 * 60 * 1000, ...limits },
    urlOptions: { ...limits, addRandomSuffix: false },
  };
}

function iso(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function numOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** DB 행(snake_case) → API 응답(camelCase). 집계 컬럼이 없으면 0/빈 배열. */
function mapPhotoRow(r) {
  return {
    id: r.id,
    uploaderId: r.uploader_id,
    mediaType: r.media_type,
    url: r.url,
    thumbUrl: r.thumb_url,
    width: r.width,
    height: r.height,
    durationSec: numOrNull(r.duration_sec),
    caption: r.caption,
    day: r.day === null || r.day === undefined ? null : Number(r.day),
    takenAt: iso(r.taken_at),
    takenAtSource: r.taken_at_source,
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    placeName: r.place_name,
    locationSource: r.location_source,
    original: {
      takenAt: iso(r.original_taken_at),
      takenAtSource: r.original_taken_at_source || null,
      lat: numOrNull(r.original_lat),
      lng: numOrNull(r.original_lng),
    },
    camera: r.camera || null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    likeCount: Number(r.like_count || 0),
    likedBy: (r.liked_by || []).map(Number),
    commentCount: Number(r.comment_count || 0),
  };
}

module.exports = {
  isBlobUrl,
  parsePhoto,
  parsePhotoPatch,
  parseLatLng,
  parsePlaceName,
  parseDay,
  dayFromTakenAt,
  sanitizeCamera,
  toInt,
  toIsoOrNull,
  uploadTokenOptions,
  presignedUploadOptions,
  mapPhotoRow,
  TAKEN_AT_SOURCES,
  LOCATION_SOURCES,
};
