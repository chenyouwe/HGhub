//! 新播放协议：匿名请求播放信息，CDN 凭证留在 Rust 侧。

use serde_json::{json, Value};

pub async fn play(id: i64, ep: u32) -> Result<Value, String> {
    if id <= 0 || ep == 0 {
        return Err("视频或集数无效".to_string());
    }
    let data = crate::net::edge(
        "POST",
        &format!("/api/videos/{id}/episodes/{ep}/playback"),
        Some(json!({})),
    ).await?;
    crate::media::prepare_playback(&data, id, ep)
}
