use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::AtomicBool;
use std::thread;
use std::time::Duration;

struct FixtureServer {
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
    stopped: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl FixtureServer {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let recorded = requests.clone();
        let stop = stopped.clone();
        let worker = thread::spawn(move || {
            while !stop.load(Ordering::Acquire) {
                let (mut stream, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(e) => panic!("fixture accept failed: {e}"),
                };
                stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut request = Vec::new();
                let mut buf = [0; 2048];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = stream.read(&mut buf).unwrap();
                    if n == 0 { break; }
                    request.extend_from_slice(&buf[..n]);
                }
                let request = String::from_utf8(request).unwrap().to_ascii_lowercase();
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let authorized = request.contains("x-cdn-auth: fixture-one") || request.contains("x-cdn-auth: fixture-two");
                recorded.lock().unwrap().push(request);
                let (status, body) = if (path == "/master.m3u8" || path == "/child") && !authorized {
                    (403, b"missing CDN header".to_vec())
                } else {
                    match path.as_str() {
                        "/master.m3u8" => (200, "\u{feff}#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"audio.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild\n".as_bytes().to_vec()),
                        "/child" => (200, b"#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:3,\nseg.ts\n#EXT-X-ENDLIST\n".to_vec()),
                        "/key.bin" => (200, vec![7; 16]),
                        "/init.mp4" => (200, vec![1; 64]),
                        "/seg.ts" => (200, vec![2; 2048]),
                        _ => (404, b"not found".to_vec()),
                    }
                };
                write!(stream, "HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        Self { base, requests, stopped, worker: Some(worker) }
    }
}

impl Drop for FixtureServer {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() { worker.join().unwrap(); }
    }
}

fn fixture(base: &str, token: &str, other: bool) -> Value {
    json!({
        "streams": { "main": format!("{base}/master.m3u8"), "hevc": "" },
        "cdn": { "m3u8Enabled": true, "otherEnabled": other,
            "authKey": "x-cdn-auth", "authValue": token, "app": "fixture-app" }
    })
}

fn context_id(local: &str) -> u64 {
    url::Url::parse(local).unwrap().query_pairs().find(|(k, _)| k == "ctx")
        .unwrap().1.parse().unwrap()
}

async fn request_proxy(local: &str) -> Response<Vec<u8>> {
    let parsed = url::Url::parse(local).unwrap();
    handle(parsed.path(), parsed.query().unwrap_or(""), LOCAL_ORIGIN).await
}

fn first_uri(text: &str, tag: &str) -> String {
    let line = text.lines().find(|line| line.starts_with(tag)).expect("missing URI tag");
    line.split("URI=\"").nth(1).unwrap().split('"').next().unwrap().to_string()
}

#[test]
fn playback_normalizes_and_keeps_credentials_out_of_frontend() {
    let normalized = prepare_playback(&fixture("https://media.example", "fixture-one", false), 5, 2).unwrap();
    let local = normalized["video_url"].as_str().unwrap();
    assert!(local.starts_with(&format!("{LOCAL_ORIGIN}/hls?")));
    assert_eq!(normalized["ep_num"], 2);
    assert!(!normalized.to_string().contains("fixture-one"));
    let id = context_id(local);
    assert_eq!(context_headers("https://media.example/master.m3u8", true, Some(id)).unwrap()["x-cdn-auth"], "fixture-one");
    assert!(context_headers("https://media.example/seg.ts", false, Some(id)).unwrap().is_empty());
    assert!(context_headers("https://another.example/master.m3u8", true, Some(id)).unwrap().is_empty());
    assert!(prepare_playback(&json!({"streams":{"main":""}}), 5, 2).is_err());
    assert!(prepare_playback(&json!({"streams":{"main":"file:///private"}}), 5, 2).is_err());
}

#[tokio::test]
async fn proxy_preserves_auth_through_nested_playlists_keys_and_segments() {
    let server = FixtureServer::start();
    let normalized = prepare_playback(&fixture(&server.base, "fixture-one", true), 5, 1).unwrap();
    let root_url = normalized["video_url"].as_str().unwrap();
    let root = request_proxy(root_url).await;
    assert_eq!(root.status(), 200);
    assert_eq!(root.headers()["Access-Control-Allow-Origin"], "*");
    let master = String::from_utf8(root.body().clone()).unwrap();
    assert!(master.starts_with("#EXTM3U"));
    assert!(first_uri(&master, "#EXT-X-MEDIA:").contains("/hls?u="));
    let variant = master.lines().find(|s| !s.starts_with('#') && !s.is_empty()).unwrap();
    assert!(variant.contains("/hls?u="));
    assert!(variant.contains("&ctx="));
    let child = request_proxy(variant).await;
    assert_eq!(child.status(), 200);
    let child = String::from_utf8(child.body().clone()).unwrap();
    let key = request_proxy(&first_uri(&child, "#EXT-X-KEY:")).await;
    assert_eq!(key.status(), 200);
    assert_eq!(key.body().len(), 16);
    let init = request_proxy(&first_uri(&child, "#EXT-X-MAP:")).await;
    assert_eq!(init.status(), 200);
    let segment = child.lines().find(|s| !s.starts_with('#') && !s.is_empty()).unwrap();
    let segment = request_proxy(segment).await;
    assert_eq!(segment.status(), 200);
    assert_eq!(segment.body().len(), 2048);
    // 同一地址刷新凭证之后必须重新取列表，不能复用旧上下文的缓存。
    assert_eq!(request_proxy(root_url).await.status(), 200);
    let refreshed = prepare_playback(&fixture(&server.base, "fixture-two", true), 5, 1).unwrap();
    assert_eq!(request_proxy(refreshed["video_url"].as_str().unwrap()).await.status(), 200);
    let recorded = server.requests.lock().unwrap();
    assert_eq!(recorded.len(), 6);
    assert!(recorded[..5].iter().all(|request| request.contains("x-cdn-auth: fixture-one") && request.contains("x-cdn-app: fixture-app")));
    assert!(recorded.last().unwrap().contains("x-cdn-auth: fixture-two"));
}

#[tokio::test]
#[ignore = "手动验证上游播放链路，需要联网时单独运行"]
async fn live_playback_chain() {
    let play = crate::playback::play(117, 1).await.expect("new playback API");
    let mut current = play["video_url"].as_str().unwrap().to_string();
    let mut media = String::new();
    for _ in 0..4 {
        let response = request_proxy(&current).await;
        assert_eq!(response.status(), 200, "playlist request failed");
        let text = String::from_utf8(response.body().clone()).unwrap();
        assert!(text.starts_with("#EXTM3U"));
        if text.contains("#EXTINF:") { media = text; break; }
        current = text.lines().find(|s| !s.starts_with('#') && !s.is_empty()).expect("variant playlist").to_string();
    }
    assert!(!media.is_empty(), "media playlist not reached");
    if media.contains("#EXT-X-KEY:") {
        let key = request_proxy(&first_uri(&media, "#EXT-X-KEY:")).await;
        assert_eq!(key.status(), 200, "key request failed");
        assert_eq!(key.body().len(), 16, "AES-128 key length");
        println!("AES key: 16 bytes, HTTP 200");
    }
    let segment = media.lines().find(|s| !s.starts_with('#') && !s.is_empty()).expect("media segment");
    let response = request_proxy(segment).await;
    assert_eq!(response.status(), 200, "segment request failed");
    assert!(response.body().len() > 1000, "segment unexpectedly empty");
    println!("Playback API and proxied HLS: OK; segment: {} bytes, HTTP 200", response.body().len());
}
