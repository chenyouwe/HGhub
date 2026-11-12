import { useEffect, useRef, useState } from "react";
import { api, APP_VERSION, logLine, platform } from "../api";
import type { Detail } from "../types";
import { useStore } from "../store";
import { Empty, Img, Modal, Toggle } from "../components/ui";
import {
  IBroom, IChevR, IClock, IHeart, IInfo, ILink, IMoon,
  IShield, IStar, ISun, Logo,
} from "../icons";

export default function Profile({ wide: _wide, bottomInset = 78 }: { wide: boolean; bottomInset?: number }) {
  const {
    theme, setTheme,
    history, favs, clearHistory, clearLocal, push, toast,
    progress,
    disguiseEnabled, disguisePin, disguiseIconSync,
    setDisguiseEnabled, setDisguisePin, setDisguiseIconSync, lockDisguiseNow,
  } = useStore();
  const [tab, setTab] = useState<"fav" | "history">("fav");
  const [tabRatio, setTabRatio] = useState(0);
  const swiperRef = useRef<HTMLDivElement>(null);
  const [favCards, setFavCards] = useState<Detail[]>([]);
  const [histCards, setHistCards] = useState<Detail[]>([]);
  const [about, setAbout] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(false);
  const [pinEditing, setPinEditing] = useState(false);
  const [pinDraft, setPinDraft] = useState(disguisePin);

  useEffect(() => {
    let alive = true;
    if (!favs.length) { setFavCards([]); return; }
    setFavLoading(true);
    Promise.allSettled(favs.slice(0, 12).map((id) => api.video(id)))
      .then((rs) => {
        if (!alive) return;
        setFavCards(rs.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Detail>).value));
      })
      .finally(() => { if (alive) setFavLoading(false); });
    return () => { alive = false; };
  }, [favs.join(",")]);

  useEffect(() => {
    let alive = true;
    if (!history.length) { setHistCards([]); return; }
    setHistLoading(true);
    Promise.allSettled(history.slice(0, 12).map((id) => api.video(id)))
      .then((rs) => {
        if (!alive) return;
        setHistCards(rs.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Detail>).value));
      })
      .finally(() => { if (alive) setHistLoading(false); });
    return () => { alive = false; };
  }, [history.join(",")]);

  const scrollToTab = (idx: number) => {
    const el = swiperRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    setTab(idx === 0 ? "fav" : "history");
    setTabRatio(idx);
  };

  const onSwiperScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const w = el.clientWidth || 1;
    const r = Math.max(0, Math.min(1, el.scrollLeft / w));
    setTabRatio(r);
    if (r < 0.3) setTab("fav");
    else if (r > 0.7) setTab("history");
  };

  return (
    <div className="absolute inset-0 bg-bg page-aura flex flex-col">
      {/* 顶部标题栏 */}
      <div className="shrink-0 px-4 pb-2 flex items-center justify-between" style={{ paddingTop: "calc(var(--sat, 0px) + 14px)" }}>
        <div className="text-[24px] font-black tracking-tight text-on leading-none">我的</div>
      </div>

      {/* 主体滚动容器（确保底部留出充足安全区，绝不被底栏遮盖） */}
      <div
        className="flex-1 scroll-y px-4 pt-1"
        style={{ paddingBottom: `calc(var(--sab, 0px) + ${Math.max(90, bottomInset + 32)}px)` }}>
        {/* 🛡️ 隐私计算器伪装锁 */}
        <div className="mt-3 rounded-(--r-lg) glass-card p-3.5 border border-white/8 a-rise">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8.5 h-8.5 rounded-xl bg-[#f7c355]/15 border border-[#f7c355]/30 flex items-center justify-center text-[#f7c355] shrink-0">
                <IShield size={17} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-bold text-on truncate">计算器伪装锁</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${disguiseEnabled ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-white/6 text-mut"}`}>
                    {disguiseEnabled ? "已开启" : "未开启"}
                  </span>
                </div>
                <div className="text-[10.5px] text-mut mt-0.5 truncate">
                  切后台或息屏秒锁 · 输入暗号恢复
                </div>
              </div>
            </div>
            <Toggle
              on={disguiseEnabled}
              onChange={(on) => {
                setDisguiseEnabled(on);
                toast(on ? `已开启伪装锁（暗号：${disguisePin}=）` : "已关闭伪装锁", "ok");
              }}
            />
          </div>

          {/* 快捷动作按钮行（平分宽度，绝不折行） */}
          {pinEditing ? (
            <div className="mt-2.5 pt-2.5 border-t border-white/6 flex items-center gap-2">
              <input
                value={pinDraft}
                onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="3-8位纯数字"
                inputMode="numeric"
                className="flex-1 h-7.5 px-3 rounded-(--r-ctl) bg-black/40 border border-[#f7c355]/40 text-[12px] font-mono text-white outline-none"
              />
              <button
                onClick={() => {
                  const clean = pinDraft.replace(/\D/g, "");
                  if (clean.length < 3) {
                    toast("暗号请至少输入 3 位数字", "info");
                    return;
                  }
                  setDisguisePin(clean);
                  setPinEditing(false);
                  toast(`暗号已修改为：输入 ${clean} 再按 =`, "ok");
                }}
                className="h-7.5 px-3 rounded-(--r-ctl) gold-grad text-[11.5px] font-bold pressable">
                保存
              </button>
              <button
                onClick={() => { setPinDraft(disguisePin); setPinEditing(false); }}
                className="h-7.5 px-2.5 rounded-(--r-ctl) bg-white/8 text-[11px] text-mut pressable">
                取消
              </button>
            </div>
          ) : (
            <div className="mt-2.5 pt-2.5 border-t border-white/6 flex items-center gap-2">
              <button
                onClick={lockDisguiseNow}
                className="flex-1 h-7.5 rounded-(--r-ctl) bg-white/8 hover:bg-white/12 border border-white/10 text-[11.5px] font-semibold text-white/90 flex items-center justify-center gap-1.5 pressable">
                <IShield size={13} className="text-[#f7c355]" />
                <span>立即锁屏伪装</span>
              </button>
              <button
                onClick={() => { setPinDraft(disguisePin); setPinEditing(true); }}
                className="h-7.5 px-3 rounded-(--r-ctl) bg-white/6 border border-white/8 text-[11px] font-mono text-[#ffd27d] flex items-center gap-1 pressable">
                <span>暗号: {disguisePin}</span>
                <span className="text-white/40 text-[10px]">改</span>
              </button>
            </div>
          )}

          {/* 桌面图标同步变计算器（动态换图标） */}
          {platform === "android" && disguiseEnabled && (
            <div className="mt-2.5 pt-2.5 border-t border-white/6 flex items-center justify-between text-[11px]">
              <span className="text-white/75">桌面图标同步换为计算器</span>
              <Toggle
                on={disguiseIconSync}
                onChange={(on) => {
                  setDisguiseIconSync(on);
                  toast(on ? "桌面图标将在数秒内切换为计算器" : "桌面图标已恢复为黄果", "ok");
                }}
              />
            </div>
          )}
        </div>

        {/* 收藏 / 历史 切换栏（水银流动指示胶囊） */}
        <div className="relative flex bg-black/30 border border-white/8 rounded-(--r-ctl) p-1 mt-3.5">
          <div
            className="absolute top-1 bottom-1 rounded-(--r-ctl) brand-grad glow-neon transition-transform duration-75 ease-out pointer-events-none"
            style={{
              width: "calc(50% - 4px)",
              left: 4,
              transform: `translateX(${tabRatio * 100}%)`,
              willChange: "transform",
            }}
          />
          <button
            onClick={() => scrollToTab(0)}
            className={`relative z-10 flex-1 h-8 text-[12px] font-bold pressable transition-colors ${tabRatio < 0.5 ? "text-white" : "text-mut"}`}>
            我的追剧
          </button>
          <button
            onClick={() => scrollToTab(1)}
            className={`relative z-10 flex-1 h-8 text-[12px] font-bold pressable transition-colors ${tabRatio >= 0.5 ? "text-white" : "text-mut"}`}>
            观看历史
          </button>
        </div>

        {/* 1:1 跟手滑动双页容器 */}
        <div
          ref={swiperRef}
          onScroll={onSwiperScroll}
          className="mt-2.5 flex overflow-x-auto no-bar snap-x snap-mandatory"
          style={{ overscrollBehaviorX: "contain" }}>
          <div className="w-full shrink-0 snap-start pr-1">
            {favLoading ? (
              <div className="flex justify-center py-8"><div className="w-7 h-7 spinner" /></div>
            ) : favCards.length ? (
              <div className="grid grid-cols-3 gap-2">
                {favCards.map((c) => {
                  const prog = progress[c.id];
                  const totalEp = c.episodes?.length || prog?.totalEp || 0;
                  return (
                    <button
                      key={c.id}
                      onClick={() => push({ kind: "feed", videoIds: favCards.map((x) => x.id), index: favCards.findIndex((x) => x.id === c.id), title: "我的追剧" })}
                      className="relative rounded-(--r-sm) overflow-hidden bg-s1 elev-1 ring-1 ring-white/8 pressable text-left" style={{ paddingTop: "135%" }}>
                      <Img src={c.cover} />
                      {prog && prog.ep >= 1 && (
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md border border-amber/30 text-[9.5px] font-bold text-[#ffd27d]">
                          看至第{prog.ep}{totalEp ? `/${totalEp}` : ""}集
                        </span>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/92 via-black/50 to-transparent p-2">
                        <div className="text-[11px] font-semibold text-white clamp-2 leading-tight">{c.title}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Empty
                icon={<IStar size={24} />}
                title="暂无追剧收藏"
                action="去看看热播剧"
                onAction={() => push({ kind: "ranks" })}
              />
            )}
          </div>

          <div className="w-full shrink-0 snap-start pl-1">
            {histLoading ? (
              <div className="flex justify-center py-8"><div className="w-7 h-7 spinner" /></div>
            ) : histCards.length ? (
              <div>
                <div className="grid grid-cols-3 gap-2">
                  {histCards.map((c) => {
                    const prog = progress[c.id];
                    const totalEp = c.episodes?.length || prog?.totalEp || 0;
                    return (
                      <button
                        key={c.id}
                        onClick={() => push({ kind: "feed", videoIds: histCards.map((x) => x.id), index: histCards.findIndex((x) => x.id === c.id), title: "观看历史" })}
                        className="relative rounded-(--r-sm) overflow-hidden bg-s1 elev-1 ring-1 ring-white/8 pressable text-left" style={{ paddingTop: "135%" }}>
                        <Img src={c.cover} />
                        {prog && prog.ep >= 1 && (
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md border border-amber/30 text-[9.5px] font-bold text-[#ffd27d]">
                            看至第{prog.ep}{totalEp ? `/${totalEp}` : ""}集
                          </span>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/92 via-black/50 to-transparent p-2">
                          <div className="text-[11px] font-semibold text-white clamp-2 leading-tight">{c.title}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button onClick={clearHistory} className="mt-2.5 w-full h-8.5 rounded-(--r-ctl) glass-card text-[11.5px] text-mut pressable">清空观看历史</button>
              </div>
            ) : (
              <Empty
                icon={<IClock size={24} />}
                title="暂无观看记录"
                action="去看看热播剧"
                onAction={() => push({ kind: "ranks" })}
              />
            )}
          </div>
        </div>

        {/* 系统设置栏 */}
        <div className="mt-4 rounded-(--r-md) glass-card divide-y divide-white/6">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="w-8 h-8 rounded-full tonal flex items-center justify-center">{theme === "dark" ? <IMoon size={15} /> : <ISun size={15} />}</span>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-on">深色外观</div>
              <div className="text-[10px] text-mut">曜石黑影院级视听配色</div>
            </div>
            <Toggle on={theme === "dark"} onChange={(on) => setTheme(on ? "dark" : "light")} label="深色外观" />
          </div>
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="w-8 h-8 rounded-full tonal flex items-center justify-center"><IHeart size={15} /></span>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-on">本机追剧数据</div>
              <div className="text-[10px] text-mut">{favs.length} 部收藏 · {history.length} 条观看记录</div>
            </div>
          </div>
        </div>

        {/* 关于 / 缓存 / 诊断 */}
        <div className="mt-2.5 rounded-(--r-md) glass-card divide-y divide-white/6">
          <button onClick={() => setAbout(true)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left pressable">
            <span className="w-8 h-8 rounded-full tonal flex items-center justify-center"><IInfo size={15} /></span>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-on">关于黄果</div>
              <div className="text-[10px] text-mut">版本 v{APP_VERSION} · 官方客户端</div>
            </div>
            <IChevR size={15} className="text-mut" />
          </button>
          <button onClick={() => setClearOpen(true)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left pressable">
            <span className="w-8 h-8 rounded-full tonal flex items-center justify-center"><IBroom size={15} /></span>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-on">清理缓存</div>
              <div className="text-[10px] text-mut">释放封面与临时视频缓存</div>
            </div>
            <IChevR size={15} className="text-mut" />
          </button>
          <button onClick={async () => {
            try {
              const text = JSON.stringify(await api.netDiag(), null, 2);
              logLine(`[net_diag] ${text}`);
              await navigator.clipboard?.writeText(text);
              toast("网络诊断结果已复制", "ok");
            } catch (e) {
              toast((e as Error).message || "诊断失败", "info");
            }
          }} className="w-full flex items-center gap-3 px-3.5 py-3 text-left pressable">
            <span className="w-8 h-8 rounded-full tonal flex items-center justify-center"><ILink size={15} /></span>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-on">网络诊断</div>
              <div className="text-[10px] text-mut">检测 DNS 与网络连通性</div>
            </div>
            <IChevR size={15} className="text-mut" />
          </button>
        </div>

        <div className="text-center text-[10px] text-dim mt-4">黄果短剧 v{APP_VERSION} · {platform === "android" ? "Android" : platform === "macos" ? "macOS" : "Windows"} 客户端</div>

        {/* 关于黄果 弹窗（已彻底抹除全部 HGhub 与开源站点外链） */}
        <Modal open={about} onClose={() => setAbout(false)} width={350}>
          <div className="p-5">
            <div className="flex items-center gap-3">
              <Logo size={42} />
              <div>
                <div className="text-[17px] font-bold text-on leading-tight">黄果短剧</div>
                <div className="text-[11px] text-mut mt-0.5">官方客户端 v{APP_VERSION}</div>
              </div>
            </div>

            <p className="text-[12px] text-on/75 leading-relaxed mt-4">
              黄果短剧致力于为您提供海量高清、沉浸流畅的短剧视听盛宴。每日全网同步热播更新，极速秒播，尊享视界。
            </p>

            <div className="mt-4 rounded-(--r-sm) bg-s3/60 p-3 space-y-2 text-[11px] text-mut">
              <div className="flex justify-between items-center">
                <span>当前版本</span>
                <span className="text-on/85 font-mono">v{APP_VERSION} (官方正版)</span>
              </div>
              <div className="flex justify-between items-center">
                <span>图形引擎</span>
                <span className="text-emerald-400 font-medium">硬件加速 · 零延迟</span>
              </div>
            </div>

            <button onClick={() => setAbout(false)} className="mt-4.5 w-full h-9 rounded-(--r-ctl) gold-grad text-[12.5px] font-bold pressable">知道了</button>
          </div>
        </Modal>

        {/* 清理缓存 确认弹窗 */}
        <Modal open={clearOpen} onClose={() => setClearOpen(false)} width={330}>
          <div className="p-5">
            <div className="text-[14.5px] font-bold text-on">清理本地缓存</div>
            <p className="text-[12px] text-mut leading-relaxed mt-2">
              将清除封面与播放列表缓存、收藏标记与观看历史记录。
            </p>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setClearOpen(false)} className="flex-1 h-9 rounded-(--r-ctl) bg-s3 text-[12.5px] text-on/80 pressable">取消</button>
              <button disabled={clearing} onClick={async () => {
                setClearing(true);
                try { await api.clearCache(); } catch { /* 忽略 */ }
                clearLocal();
                setClearing(false);
                setClearOpen(false);
                toast("缓存已清理", "ok");
              }} className="flex-1 h-9 rounded-(--r-ctl) gold-grad text-[12.5px] font-semibold text-black pressable disabled:opacity-60">
                {clearing ? "清理中…" : "确定清理"}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
