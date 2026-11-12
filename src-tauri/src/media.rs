//! 媒体层：封面解密 + HLS 代理。
//!
//! 站点封面是 AES-128-CBC 密文，m3u8 内部分片/key 又可能被 WebView 的 CORS 拦住，
//! 所以图片与视频统一走本地自定义协议（Windows/Android 为 `http://hg.localhost`，
//! macOS 为 `hg://localhost`，见 [`LOCAL_ORIGIN`]）。

use crate::net::{fetch_bytes, fetch_bytes_with_headers};
use aes::cipher::{BlockDecrypt, KeyInit};
use aes::Aes128;
use once_cell::sync::Lazy;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::http::{Response, StatusCode};

/// 本平台自定义协议的完整基址。
///
/// Tauri 的自定义协议地址随平台不同：Windows / Android 是 `http://<scheme>.localhost`，
/// macOS / iOS / Linux 是 `<scheme>://localhost`。m3u8 里的分片与 key 地址按它改写。
/// 前端 `src/api.ts` 的 `LOCAL` 必须与此一致，否则封面与视频全部加载失败。
#[cfg(any(target_os = "windows", target_os = "android"))]
pub const LOCAL_ORIGIN: &str = "http://hg.localhost";
#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub const LOCAL_ORIGIN: &str = "hg://localhost";

const IMG_KEY: &[u8] = b"f5d965df75336270";
const IMG_IV: &[u8] = b"97b60394abc2fbe1";

static IMG_CACHE: Lazy<Mutex<HashMap<String, Arc<Vec<u8>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static PL_CACHE: Lazy<Mutex<HashMap<String, Arc<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const IMG_CACHE_MAX: usize = 240;
const PL_CACHE_MAX: usize = 60;

#[derive(Clone)]
struct PlaybackContext {
    origins: HashSet<String>,
    headers: HeaderMap,
    playlist_auth: bool,
    other_auth: bool,
}

static PLAYBACK_CONTEXTS: Lazy<Mutex<BTreeMap<u64, Arc<PlaybackContext>>>> =
    Lazy::new(|| Mutex::new(BTreeMap::new()));
static NEXT_CONTEXT: AtomicU64 = AtomicU64::new(1);
const CONTEXT_MAX: usize = 256;

fn media_origin(raw: &str) -> Result<String, String> {
    let url = url::Url::parse(raw).map_err(|_| "播放地址格式无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("播放地址协议不受支持".to_string());
    }
    Ok(url.origin().ascii_serialization())
}

/// 保持前端 PlayInfo 的结构，CDN 凭证只保存在本进程，不放进代理 URL 或日志。
pub fn prepare_playback(data: &Value, id: i64, ep: u32) -> Result<Value, String> {
    let main = data.pointer("/streams/main").and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "该剧集暂无播放地址，请稍后重试".to_string())?;
    let hevc = data.pointer("/streams/hevc").and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty());
    let mut origins = HashSet::from([media_origin(main)?]);
    if let Some(url) = hevc { origins.insert(media_origin(url)?); }
    let cdn = &data["cdn"];
    let playlist_auth = cdn["m3u8Enabled"].as_bool().unwrap_or(false);
    let other_auth = cdn["otherEnabled"].as_bool().unwrap_or(false);
    let mut headers = HeaderMap::new();
    if playlist_auth || other_auth {
        let name = cdn["authKey"].as_str().unwrap_or("");
        let value = cdn["authValue"].as_str().filter(|s| !s.is_empty())
            .ok_or_else(|| "播放接口缺少 CDN 凭证".to_string())?;
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "播放接口的 CDN 请求头无效".to_string())?;
        if !name.as_str().starts_with("x-") {
            return Err("播放接口的 CDN 请求头不受支持".to_string());
        }
        headers.insert(name, HeaderValue::from_str(value)
            .map_err(|_| "播放接口的 CDN 凭证无效".to_string())?);
        if let Some(app) = cdn["app"].as_str().filter(|s| !s.is_empty()) {
            headers.insert("x-cdn-app", HeaderValue::from_str(app)
                .map_err(|_| "播放接口的 CDN 应用标识无效".to_string())?);
        }
    }
    let context = NEXT_CONTEXT.fetch_add(1, Ordering::Relaxed);
    {
        let mut contexts = PLAYBACK_CONTEXTS.lock().unwrap();
        if contexts.len() >= CONTEXT_MAX {
            if let Some(oldest) = contexts.keys().next().copied() { contexts.remove(&oldest); }
        }
        contexts.insert(context, Arc::new(PlaybackContext { origins, headers, playlist_auth, other_auth }));
    }
    Ok(json!({
        "id": id,
        "ep_num": ep,
        "duration": data["duration"].as_f64().unwrap_or(0.0),
        "title": data["title"].as_str().unwrap_or(""),
        "video_url": proxy_stream(main, context),
        "video_url_hevc": hevc.map(|url| proxy_stream(url, context)),
    }))
}

fn proxy_stream(url: &str, context: u64) -> String {
    let path = url::Url::parse(url).map(|u| u.path().to_ascii_lowercase()).unwrap_or_default();
    let route = if path.ends_with(".mp4") { "seg" } else { "hls" };
    format!("{LOCAL_ORIGIN}/{route}?u={}&ctx={context}", enc(url))
}

fn context_headers(url: &str, playlist: bool, context: Option<u64>) -> Result<HeaderMap, String> {
    let Some(id) = context else { return Ok(HeaderMap::new()); };
    let context = PLAYBACK_CONTEXTS.lock().unwrap().get(&id).cloned()
        .ok_or_else(|| "播放凭证已失效，请点击重试刷新地址".to_string())?;
    // 分片或密钥指向其他来源时，不把 CDN 凭证传给那个来源。
    let authorized = context.origins.contains(&media_origin(url)?);
    let enabled = if playlist { context.playlist_auth } else { context.other_auth };
    Ok(if authorized && enabled { context.headers.clone() } else { HeaderMap::new() })
}

async fn fetch_media(url: &str, playlist: bool, context: Option<u64>) -> Result<(Option<String>, Vec<u8>), String> {
    let headers = context_headers(url, playlist, context)?;
    if context.is_some() {
        fetch_bytes_with_headers(url, headers).await
    } else {
        fetch_bytes(url).await
    }
}

fn cache_put<V: Clone>(map: &Mutex<HashMap<String, V>>, key: String, val: V, max: usize) {
    let mut m = map.lock().unwrap();
    if m.len() >= max {
        if let Some(k) = m.keys().next().cloned() {
            m.remove(&k);
        }
    }
    m.insert(key, val);
}

/* ───────────────────────── AES 解密 ───────────────────────── */

fn aes_cbc_decrypt(data: &[u8]) -> Option<Vec<u8>> {
    if data.is_empty() || data.len() % 16 != 0 {
        return None;
    }
    let cipher = Aes128::new_from_slice(IMG_KEY).ok()?;
    let mut prev = [0u8; 16];
    prev.copy_from_slice(IMG_IV);
    let mut out = Vec::with_capacity(data.len());
    for chunk in data.chunks(16) {
        let mut ct = [0u8; 16];
        ct.copy_from_slice(chunk);
        let mut block = ct;
        cipher.decrypt_block((&mut block).into());
        for i in 0..16 {
            out.push(block[i] ^ prev[i]);
        }
        prev = ct;
    }
    Some(out)
}

fn strip_padding(mut buf: Vec<u8>) -> Vec<u8> {
    let pad = *buf.last().unwrap_or(&0) as usize;
    if pad > 0 && pad <= 16 && buf.len() >= pad {
        if buf[buf.len() - pad..].iter().all(|b| *b as usize == pad) {
            buf.truncate(buf.len() - pad);
        }
    }
    buf
}

fn image_kind(buf: &[u8]) -> Option<&'static str> {
    if buf.len() < 12 {
        return None;
    }
    if buf[0] == 0xFF && buf[1] == 0xD8 {
        return Some("image/jpeg");
    }
    if buf.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Some("image/png");
    }
    if buf.starts_with(b"GIF8") {
        return Some("image/gif");
    }
    if buf.starts_with(b"RIFF") && &buf[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

/// 取封面：命中缓存直接返回，否则下载并按需解密。
pub async fn load_image(url: &str) -> Result<(String, Arc<Vec<u8>>), String> {
    if let Some(hit) = IMG_CACHE.lock().unwrap().get(url).cloned() {
        let kind = image_kind(&hit).unwrap_or("image/jpeg");
        return Ok((kind.to_string(), hit));
    }
    let (_, bytes) = fetch_bytes(url).await?;
    let plain = if image_kind(&bytes).is_some() {
        bytes
    } else {
        let dec = aes_cbc_decrypt(&bytes).ok_or_else(|| "封面解密失败".to_string())?;
        strip_padding(dec)
    };
    let kind = image_kind(&plain).unwrap_or("image/jpeg").to_string();
    let arc = Arc::new(plain);
    cache_put(&IMG_CACHE, url.to_string(), arc.clone(), IMG_CACHE_MAX);
    Ok((kind, arc))
}

/* ───────────────────────── HLS 播放列表 ───────────────────────── */

fn enc(s: &str) -> String {
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

fn absolutize(base: &str, target: &str) -> String {
    if target.starts_with("http://") || target.starts_with("https://") {
        return target.to_string();
    }
    if let Ok(b) = url::Url::parse(base) {
        if let Ok(j) = b.join(target) {
            return j.to_string();
        }
    }
    target.to_string()
}

fn rewrite_uri_attr(line: &str, prefix: &str, route: &str, context: Option<u64>) -> String {
    // 改写密钥和初始化片段等标签中的 URI 属性，并保留播放凭证上下文。
    if let Some(start) = line.find("URI=\"") {
        let rest = &line[start + 5..];
        if let Some(end) = rest.find('"') {
            let uri = &rest[..end];
            let new = proxy_resource(prefix, route, uri, context);
            return format!("{}{}{}", &line[..start + 5], new, &rest[end..]);
        }
    }
    line.to_string()
}

fn proxy_resource(prefix: &str, route: &str, url: &str, context: Option<u64>) -> String {
    let suffix = context.map(|id| format!("&ctx={id}")).unwrap_or_default();
    format!("{prefix}/{route}?u={}{suffix}", enc(url))
}

/// 取 m3u8 并把 key / 分片地址改写到本地协议。
async fn load_playlist(url: &str, prefix: &str, context: Option<u64>) -> Result<Arc<String>, String> {
    let cache_key = format!("{context:?}\n{prefix}\n{url}");
    if let Some(hit) = PL_CACHE.lock().unwrap().get(&cache_key).cloned() {
        return Ok(hit);
    }
    let (_, bytes) = fetch_media(url, true, context).await?;
    let text = String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').trim_start().to_string();
    if !text.starts_with("#EXTM3U") {
        return Err("上游未返回有效播放列表，请点击重试".to_string());
    }

    let mut out = String::with_capacity(text.len() + 512);
    let mut variant_next = false;
    for raw in text.lines() {
        let line = raw.trim_end();
        if line.is_empty() {
            out.push('\n');
            continue;
        }
        if line.starts_with('#') {
            if line.starts_with("#EXT-X-KEY") || line.starts_with("#EXT-X-SESSION-KEY") || line.starts_with("#EXT-X-MAP") {
                // 先把相对 URI 绝对化再改写
                let absolute = absolutize_uri_in_attr(url, line);
                out.push_str(&rewrite_uri_attr(&absolute, prefix, "seg", context));
            } else if line.starts_with("#EXT-X-MEDIA:") || line.starts_with("#EXT-X-I-FRAME-STREAM-INF:") {
                let absolute = absolutize_uri_in_attr(url, line);
                out.push_str(&rewrite_uri_attr(&absolute, prefix, "hls", context));
            } else {
                out.push_str(line);
            }
            if line.starts_with("#EXT-X-STREAM-INF:") { variant_next = true; }
        } else {
            let absolute = absolutize(url, line);
            let clean_path = absolute.split('?').next().unwrap_or(&absolute);
            let route = if variant_next || clean_path.ends_with(".m3u8") { "hls" } else { "seg" };
            out.push_str(&proxy_resource(prefix, route, &absolute, context));
            variant_next = false;
        }
        out.push('\n');
    }

    let arc = Arc::new(out);
    cache_put(&PL_CACHE, cache_key, arc.clone(), PL_CACHE_MAX);
    Ok(arc)
}

fn absolutize_uri_in_attr(base: &str, line: &str) -> String {
    if let Some(start) = line.find("URI=\"") {
        let rest = &line[start + 5..];
        if let Some(end) = rest.find('"') {
            let uri = &rest[..end];
            let abs = absolutize(base, uri);
            return format!("{}{}{}", &line[..start + 5], abs, &rest[end..]);
        }
    }
    line.to_string()
}

/// 清空封面 / 播放列表内存缓存
pub fn clear_caches() {
    if let Ok(mut g) = IMG_CACHE.lock() { g.clear(); }
    if let Ok(mut g) = PL_CACHE.lock() { g.clear(); }
}

/* ───────────────────────── 协议响应 ───────────────────────── */

fn respond(
    status: u16,
    ctype: &str,
    body: Vec<u8>,
    cache: &str,
) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
        .header("Content-Type", ctype)
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", cache)
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// 统一入口：`<LOCAL_ORIGIN>/img?u=` / `hls?u=` / `seg?u=`
///
/// `origin` 是本平台自定义协议的完整基址，见 [`LOCAL_ORIGIN`]；用于改写 m3u8 里的
/// 分片与 key 地址。正常情况下调用方直接传 [`LOCAL_ORIGIN`]。
pub async fn handle(path: &str, query: &str, origin: &str) -> Response<Vec<u8>> {
    let params: HashMap<_, _> = url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();
    let target = params.get("u").cloned().unwrap_or_default();
    let context = match params.get("ctx") {
        Some(raw) => match raw.parse::<u64>() {
            Ok(id) => Some(id),
            Err(_) => return respond(400, "text/plain", b"invalid playback context".to_vec(), "no-store"),
        },
        None => None,
    };

    if target.is_empty() {
        return respond(400, "text/plain", b"missing u".to_vec(), "no-store");
    }

    match path {
        "/img" => match load_image(&target).await {
            Ok((kind, bytes)) => respond(200, &kind, bytes.as_ref().clone(), "public, max-age=86400"),
            Err(e) => respond(502, "text/plain", e.into_bytes(), "no-store"),
        },
        "/hls" => match load_playlist(&target, origin, context).await {
            Ok(text) => respond(
                200,
                "application/vnd.apple.mpegurl",
                text.as_bytes().to_vec(),
                "no-store",
            ),
            Err(e) => respond(502, "text/plain", e.into_bytes(), "no-store"),
        },
        "/seg" => match fetch_media(&target, false, context).await {
            Ok((ctype, bytes)) => respond(
                200,
                ctype.as_deref().unwrap_or("application/octet-stream"),
                bytes,
                "public, max-age=3600",
            ),
            Err(e) => respond(502, "text/plain", e.into_bytes(), "no-store"),
        },
        _ => respond(404, "text/plain", b"not found".to_vec(), "no-store"),
    }
}

#[cfg(test)]
#[path = "media_tests.rs"]
mod tests;
