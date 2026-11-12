import { useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import type { Comment, CommentPage, Episode } from "../types";
import { Avatar, Empty } from "./ui";
import { IClose, IHeart } from "../icons";

/* ================= 选集 ================= */
export function EpisodesPanel({ videoId: _videoId, episodes, current, onPick, onClose }: {
  videoId: number; episodes: Episode[]; current: number; onPick: (ep: number) => void; onClose: () => void;
}) {
  const [asc, setAsc] = useState(true);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const list = asc ? episodes : [...episodes].reverse();

  useEffect(() => {
    const timer = setTimeout(() => {
      activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => clearTimeout(timer);
  }, [current, asc]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-4 h-12">
        <span className="text-[14px] font-extrabold text-on">选集</span>
        <span className="text-[11px] text-mut">共 {episodes.length} 集</span>
        <button onClick={() => setAsc((v) => !v)} className="ml-auto text-[11.5px] font-bold text-primary pressable">{asc ? "倒序" : "正序"}</button>
        <button onClick={onClose} aria-label="关闭" className="w-7 h-7 rounded-full bg-s3 flex items-center justify-center text-mut pressable">
          <IClose size={13} />
        </button>
      </div>
      <div className="flex-1 scroll-y px-4 pb-4">
        <div className="grid grid-cols-4 gap-2">
          {list.map((e) => {
            const isCur = e.ep_num === current;
            return (
              <button
                key={e.ep_num}
                ref={isCur ? activeRef : undefined}
                onClick={() => onPick(e.ep_num)}
                className={`h-10 rounded-(--r-sm) text-[12.5px] font-bold pressable transition-all ${
                  isCur
                    ? "brand-grad glow-neon ring-2 ring-primary/40 scale-[1.02]"
                    : "bg-white/6 border border-white/8 text-on/85 hover:bg-white/10"
                }`}>
                第 {e.ep_num} 集
              </button>
            );
          })}
        </div>
        {!episodes.length && <div className="text-center text-[11.5px] text-dim py-8">暂无剧集</div>}
      </div>
    </div>
  );
}

/* ================= 评论 ================= */
export function CommentsPanel({ videoId, ep, total, kind = "video", onClose }: {
  videoId: number; ep: number; total: number; kind?: "video" | "post"; onClose: () => void;
}) {
  const [items, setItems] = useState<Comment[]>([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = async (p: number) => {
    setLoading(true);
    try {
      const res: CommentPage | null = kind === "post"
        ? await api.postComments(videoId, p, 20)
        : await api.comments(videoId, ep, p, 20);
      setItems((prev) => {
        const base = p === 1 ? [] : prev;
        const seen = new Set(base.map((x) => x.id));
        return [...base, ...(res?.items || []).filter((x) => !seen.has(x.id))];
      });
      setPage(p);
      setPages(res?.pagination?.pages || 1);
    } catch {
      if (p === 1) setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [videoId, ep, kind]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-4 h-12">
        <span className="text-[13.5px] font-bold text-on">评论</span>
        <span className="text-[10.5px] text-mut">{fmt(total)} · 第 {ep} 集</span>
        <button onClick={onClose} aria-label="关闭" className="ml-auto w-7 h-7 rounded-full bg-s3 flex items-center justify-center text-mut pressable">
          <IClose size={13} />
        </button>
      </div>

      <div className="flex-1 scroll-y px-4">
        {items.length ? items.map((c) => (
          <div key={c.id} className="flex gap-2.5 py-3 border-b border-white/5 last:border-0">
            <Avatar size={32} name={c.nickname} hue={(c.user_id * 37) % 360} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11.5px] font-semibold text-on/90">{c.nickname}</span>
                <span className="text-[10px] text-dim">{c.time}</span>
              </div>
              <p className="text-[12.5px] text-on/80 mt-1 leading-relaxed whitespace-pre-wrap">{c.text}</p>
              <div className="flex items-center gap-3 mt-1.5 text-[10.5px] text-dim">
                <span className="flex items-center gap-1"><IHeart size={11} />{c.like_count || 0}</span>
                {c.reply_count > 0 && <span>{c.reply_count} 条回复</span>}
              </div>
            </div>
          </div>
        )) : loading ? (
          <div className="flex justify-center py-10"><div className="w-7 h-7 spinner" /></div>
        ) : (
          <Empty icon={<IHeart size={22} />} title="还没有评论" />
        )}
        {items.length > 0 && (
          <div className="flex justify-center py-4">
            {loading ? <div className="w-5 h-5 spinner" />
              : page < pages ? (
                <button onClick={() => load(page + 1)} className="px-4 h-8 rounded-(--r-ctl) bg-s3 text-[11.5px] text-on/80 pressable">查看更多</button>
              ) : <span className="text-[10.5px] text-dim">— 到底啦 —</span>}
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 py-3 bg-s2/70 text-center text-[11px] text-dim">
        仅展示已有评论
      </div>
    </div>
  );
}
/* ================= 图文正文（吃瓜） ================= */
export function ArticlePanel({ title, html, cover, hot, onClose }: {
  title: string; html: string; cover?: string; hot?: number; onClose: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-2 px-4 h-12">
        <span className="text-[13.5px] font-bold text-on">图文详情</span>
        {hot ? <span className="text-[10.5px] text-mut">{fmt(hot)} 热度</span> : null}
        <button onClick={onClose} aria-label="关闭" className="ml-auto w-7 h-7 rounded-full bg-s3 flex items-center justify-center text-mut pressable">
          <IClose size={13} />
        </button>
      </div>
      <div className="flex-1 scroll-y px-4 pb-6">
        {cover && <img src={cover} alt="" className="w-full rounded-(--r-md) mb-3 object-cover" />}
        <h2 className="text-[16px] font-bold text-on leading-snug">{title}</h2>
        <div className="article-body mt-3" dangerouslySetInnerHTML={{ __html: html }} />
        {!html && <p className="text-[12px] text-dim mt-4">这篇内容没有正文，可能只有图片或视频。</p>}
      </div>
    </div>
  );
}