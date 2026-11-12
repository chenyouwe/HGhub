//! 业务命令：公开列表 / 详情 / 播放 / 评论查看。

use crate::net::edge;
use serde_json::Value;
use tauri::State;

pub struct Api;

impl Api {
    pub fn new() -> Self {
        Self
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        edge("GET", path, None).await
    }
}

/// 诊断用：把前端自检结果写到应用数据目录 debug.log
#[tauri::command]
pub async fn debug_log(app: tauri::AppHandle, msg: String) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("debug.log");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", msg);
    }
    Ok(())
}

/// 网络自检：系统代理 / DNS / 连通性快照，用于远程定位「打不开」。
#[tauri::command]
pub async fn net_diag() -> Result<Value, String> {
    Ok(crate::net::diagnose().await)
}

/* ───────────────────────── 列表 ───────────────────────── */

#[tauri::command]
pub async fn api_feed(
    app: tauri::AppHandle,
    state: State<'_, Api>,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    match state.get(&format!("/api/videos?page={page}&size={size}")).await {
        Ok(v) => {
            let count = v.get("items").and_then(|i| i.as_array()).map(|a| a.len()).unwrap_or(0);
            let _ = debug_log(app, format!("[api] api_feed p={} sz={} → items={}", page, size, count)).await;
            Ok(v)
        }
        Err(e) => {
            let _ = debug_log(app, format!("[api] api_feed p={} sz={} → err: {}", page, size, e)).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn api_category(
    app: tauri::AppHandle,
    state: State<'_, Api>,
    cate: String,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    match state
        .get(&format!(
            "/api/videos/category/{cate}?page={page}&size={size}"
        ))
        .await
    {
        Ok(v) => {
            let count = v.get("items").and_then(|i| i.as_array()).map(|a| a.len()).unwrap_or(0);
            let _ = debug_log(app, format!("[api] api_category cate={} p={} → items={}", cate, page, count)).await;
            Ok(v)
        }
        Err(e) => {
            let _ = debug_log(app, format!("[api] api_category cate={} p={} → err: {}", cate, page, e)).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn api_rank(state: State<'_, Api>, kind: String) -> Result<Value, String> {
    let kind = match kind.as_str() {
        "recommend" | "potential" => kind,
        _ => "hot".to_string(),
    };
    state.get(&format!("/api/ranks/{kind}")).await
}

#[tauri::command]
pub async fn api_search(
    state: State<'_, Api>,
    q: String,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    let encoded: String = url::form_urlencoded::byte_serialize(q.as_bytes()).collect();
    state
        .get(&format!("/api/search?q={encoded}&page={page}&size={size}"))
        .await
}

#[tauri::command]
pub async fn api_posts(state: State<'_, Api>, page: u32, size: u32) -> Result<Value, String> {
    state
        .get(&format!("/api/posts?page={page}&size={size}"))
        .await
}

#[tauri::command]
pub async fn api_post(state: State<'_, Api>, id: i64) -> Result<Value, String> {
    state.get(&format!("/api/posts/{id}")).await
}

/* ───────────────────────── 详情 / 播放 ───────────────────────── */

#[tauri::command]
pub async fn api_video(state: State<'_, Api>, id: i64) -> Result<Value, String> {
    state.get(&format!("/api/videos/{id}")).await
}

#[tauri::command]
pub async fn api_play(id: i64, ep: u32) -> Result<Value, String> {
    crate::playback::play(id, ep).await
}

/* ───────────────────────── 评论查看 ───────────────────────── */

#[tauri::command]
pub async fn api_comments(
    state: State<'_, Api>,
    id: i64,
    ep: u32,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    state
        .get(&format!(
            "/api/videos/{id}/comments?ep={ep}&page={page}&size={size}"
        ))
        .await
}

/* ───────────────────────── 本地缓存 ───────────────────────── */

#[tauri::command]
pub async fn cache_clear() -> Result<(), String> {
    crate::media::clear_caches();
    Ok(())
}

#[tauri::command]
pub async fn api_post_comments(
    state: State<'_, Api>,
    id: i64,
    page: u32,
    size: u32,
) -> Result<Value, String> {
    state
        .get(&format!("/api/posts/{id}/comments?page={page}&size={size}"))
        .await
}

#[tauri::command]
pub async fn set_launcher_icon(icon: String) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
        let j_icon = env.new_string(&icon).map_err(|e| e.to_string())?;
        let res = env
            .call_method(
                &activity,
                "setLauncherIcon",
                "(Ljava/lang/String;)Z",
                &[(&j_icon).into()],
            )
            .map_err(|e| e.to_string())?;
        return Ok(res.z().unwrap_or(false));
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = icon;
        Ok(true)
    }
}
