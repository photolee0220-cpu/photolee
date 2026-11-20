import { ExternalLink, Megaphone, PlayCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { Button, Card, cx, Empty, Spinner } from '../components/ui';
import { api } from '../lib/client';
import { useAppSettings } from '../lib/settings';
import type { YouTubeVideo } from '../lib/types';
import { formatDate } from '../lib/week';
import { useStore } from '../state/store';

export const DEFAULT_YOUTUBE = 'https://www.youtube.com/@SADAKDARITV';

/** 사닥다리 유튜브: 최신 영상을 앱 안에서 바로 보고, 채널은 유튜브 앱으로 연다 */
export function YouTubePage() {
  const { me, toast } = useStore();
  const settings = useAppSettings();
  const channel = settings?.youtubeUrl?.trim() || DEFAULT_YOUTUBE;
  const [videos, setVideos] = useState<YouTubeVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<YouTubeVideo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!settings) return;
    api.youtube.videos(channel).then((v) => { setVideos(v); setCurrent(v[0] ?? null); }).catch((e) => { setVideos([]); setError(e instanceof Error ? e.message : '영상 목록을 불러오지 못했습니다.'); });
  }, [channel, settings]);
  const canNotice = me.isCeo || (me.isAdmin && false);
  const announce = async (v: YouTubeVideo) => {
    setBusy(true);
    try {
      await api.talk.notices.save({ title: `[사닥다리 유튜브] ${v.title.replace(/^\[견본\]\s*/, '')}`, body: `새 영상이 올라왔습니다.\nhttps://www.youtube.com/watch?v=${v.id}\n\n사닥다리 유튜브 메뉴에서도 볼 수 있습니다.`, requireAck: false, pinned: false });
      toast('전 직원에게 공지로 알렸습니다.');
    } catch (e) { toast(e instanceof Error ? e.message : '알리지 못했습니다.', 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="사닥다리 유튜브" right={
        <a href={channel} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#cc0000] px-4 text-[14px] font-bold text-white hover:bg-[#b00000]">
          <PlayCircle size={17} />유튜브에서 보기·구독
        </a>
      }>
        <span className="text-[13px] text-ink-3">회사 채널의 새 영상을 여기서 바로 볼 수 있습니다</span>
      </PageHeader>

      {!videos ? <div className="flex justify-center py-20"><Spinner /></div> : !videos.length ? (
        <Empty title={error ? '영상 목록을 불러오지 못했습니다' : '아직 올라온 영상이 없습니다'} icon={<PlayCircle size={22} />}>
          <a href={channel} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-ink underline">유튜브 채널로 가기</a>
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          {current && (
            <div className="min-w-0">
              <div className="relative aspect-video w-full max-w-full overflow-hidden rounded-xl bg-black">
                {api.mode === 'demo' ? (
                  <>
                    <img src={current.thumbnail} alt="" className="h-full w-full object-cover opacity-60" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
                      <PlayCircle size={56} strokeWidth={1.4} />
                      <p className="text-[14px] font-semibold">체험판에서는 영상이 재생되지 않습니다</p>
                      <p className="text-[12.5px] text-white/80">실제 사이트에서는 여기서 바로 재생됩니다</p>
                    </div>
                  </>
                ) : (
                  <iframe key={current.id} src={`https://www.youtube-nocookie.com/embed/${current.id}?rel=0&playsinline=1`} title={current.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen className="h-full w-full border-0" />
                )}
              </div>
              <h2 className="mt-3 text-[17px] font-bold leading-snug">{current.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-ink-3">{formatDate(current.published)}</span>
                <a href={`https://www.youtube.com/watch?v=${current.id}`} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-brand-ink hover:underline"><ExternalLink size={14} />유튜브 앱으로</a>
                {canNotice && <Button size="sm" disabled={busy} onClick={() => void announce(current)}>{busy ? <Spinner /> : <Megaphone size={14} />}전 직원에게 알리기</Button>}
              </div>
            </div>
          )}
          <Card className="min-w-0 p-2">
            <p className="px-2 pb-1 pt-1.5 text-[13px] font-bold text-ink-2">최근 영상</p>
            <ul className="max-h-[560px] overflow-y-auto scrollbar-thin">
              {videos.map((v) => (
                <li key={v.id}>
                  <button onClick={() => { setCurrent(v); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className={cx('flex w-full gap-3 rounded-lg p-2 text-left', current?.id === v.id ? 'bg-brand-soft' : 'hover:bg-sunken')}>
                    <img src={v.thumbnail} alt="" loading="lazy" className="aspect-video w-32 shrink-0 rounded-md bg-sunken object-cover" />
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{v.title}</span>
                      <span className="mt-1 block text-[12px] text-ink-3">{formatDate(v.published)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
