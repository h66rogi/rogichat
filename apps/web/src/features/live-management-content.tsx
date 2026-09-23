"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { EndSessionConfirmDialog } from "@/meloming/domains/overlay/components/end-session-confirm-dialog";
import { useActiveSession, useEndSession, useStartSession, useUpdateSessionSettings, sessionKeys } from "@/meloming/domains/overlay/hooks/use-session";
import {
  songRequestKeys, useCreateManualSongRequest, useDeleteSongRequest,
  useNowPlaying, usePlayNext, usePlayNow, useSkipCurrent,
  useSongRequestQueue, useUpdateSongRequestOrder, useUpdateSongRequestStatus,
} from "@/meloming/domains/overlay/hooks/use-song-requests";
import { useSongLiveSocket } from "@/meloming/domains/overlay/hooks/use-song-live-socket";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";

/** Rogichat manager surface composed from the copied Meloming session/queue hooks. */
export function LiveManagementContent({ user }: { user:string }) {
  const queryClient=useQueryClient();
  const [endOpen,setEndOpen]=useState(false);
  const [rawArtist,setRawArtist]=useState("");
  const [rawTitle,setRawTitle]=useState("");
  const active=useActiveSession(user);
  const start=useStartSession(user);
  const end=useEndSession(user);
  const sessionId=active.data?.id??null;
  const settings=useUpdateSessionSettings(user,1);
  const queue=useSongRequestQueue(sessionId);
  const nowPlaying=useNowPlaying(sessionId);
  const playNext=usePlayNext(sessionId);
  const skip=useSkipCurrent(sessionId);
  const playNow=usePlayNow(sessionId);
  const status=useUpdateSongRequestStatus(sessionId);
  const remove=useDeleteSongRequest(sessionId);
  const reorder=useUpdateSongRequestOrder(sessionId);
  const manual=useCreateManualSongRequest(sessionId);

  const refresh=()=>{
    void queryClient.invalidateQueries({queryKey:songRequestKeys.all});
    void queryClient.invalidateQueries({queryKey:sessionKeys.active(user)});
  };
  useSongLiveSocket(user,{enabled:true,onRequestAdded:refresh,onRequestUpdated:refresh,
    onRequestRemoved:refresh,onQueueReordered:refresh,onSessionStarted:refresh,onSessionEnded:refresh});

  const run=async(action:Promise<unknown>,success:string)=>{
    try{await action;toast.success(success);refresh();return true;}
    catch(error){toast.error(extractApiErrorMessage(error,"요청을 처리하지 못했어요"));return false;}
  };
  const requests=queue.data?.queue.filter((request)=>request.status==="PENDING"||request.status==="ACCEPTED")??[];
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">라이브 신청곡</h1>
          <p className="text-sm text-muted-foreground">방송 중 신청곡과 재생 순서를 관리합니다.</p></div>
        <Link href={`/channel/${user}/manage/session-history`} className="text-sm underline">방송 기록</Link>
      </div>
      {active.isLoading ? <p>방송 상태를 불러오는 중...</p> : !active.data ? (
        <div className="rounded-xl border p-6 space-y-3">
          <p>진행 중인 방송이 없습니다.</p>
          <Button disabled={start.isPending} onClick={()=>void run(start.mutateAsync({platform:"SOOP"}),"신청곡 방송을 시작했어요")}>방송 시작</Button>
        </div>
      ) : <>
        <section className="rounded-xl border p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold">진행 중인 방송</h2>
              <p className="text-xs text-muted-foreground">시작: {new Date(active.data.startedAt).toLocaleString("ko-KR")}</p></div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={settings.isPending} onClick={()=>void run(settings.mutateAsync({sessionId,settings:{paused:!active.data?.settings?.paused}}),"신청 상태를 변경했어요")}>
                {active.data.settings?.paused?"신청 재개":"신청 일시정지"}
              </Button>
              <Button variant="destructive" onClick={()=>setEndOpen(true)}>방송 종료</Button>
            </div>
          </div>
          <div className="rounded-lg bg-muted p-4">
            <span className="text-xs text-muted-foreground">현재 곡</span>
            <p className="font-semibold">{nowPlaying.data ? `${nowPlaying.data.song?.title??nowPlaying.data.rawTitle} · ${nowPlaying.data.song?.artist.name??nowPlaying.data.rawArtist}` : "재생 중인 곡 없음"}</p>
            <div className="mt-3 flex gap-2">
              <Button disabled={playNext.isPending||requests.length===0} onClick={()=>void run(playNext.mutateAsync(),"다음 곡을 재생해요")}>다음 곡</Button>
              <Button variant="outline" disabled={skip.isPending||!nowPlaying.data} onClick={()=>void run(skip.mutateAsync(undefined),"현재 곡을 건너뛰었어요")}>건너뛰기</Button>
            </div>
          </div>
        </section>
        <section className="rounded-xl border p-5 space-y-3">
          <h2 className="font-semibold">수동 신청곡 추가</h2>
          <form className="flex flex-wrap gap-2" onSubmit={event=>{
            event.preventDefault();if(!rawTitle.trim()||!rawArtist.trim())return;
            void run(manual.mutateAsync({rawTitle:rawTitle.trim(),rawArtist:rawArtist.trim()}),"대기열에 추가했어요").then(ok=>{if(ok){setRawTitle("");setRawArtist("");}});
          }}>
            <Input aria-label="가수" placeholder="가수" value={rawArtist} onChange={event=>setRawArtist(event.target.value)} className="min-w-32 flex-1" />
            <Input aria-label="곡명" placeholder="곡명" value={rawTitle} onChange={event=>setRawTitle(event.target.value)} className="min-w-32 flex-1" />
            <Button type="submit" disabled={manual.isPending}>추가</Button>
          </form>
        </section>
        <section className="rounded-xl border p-5 space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold">대기열 ({requests.length})</h2>
            <Button variant="ghost" onClick={()=>void queue.refetch()}>새로고침</Button></div>
          {requests.length===0?<p className="text-sm text-muted-foreground">대기 중인 신청곡이 없습니다.</p>:
            <ol className="space-y-2">{requests.map((request,index)=><li key={request.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-medium">{request.song?.title??request.rawTitle} · {request.song?.artist.name??request.rawArtist}</p>
                  <p className="text-xs text-muted-foreground">{request.requesterNickname} · {request.status}</p></div>
                <div className="flex flex-wrap gap-1">
                  {request.status==="PENDING"&&<Button size="sm" variant="outline" onClick={()=>void run(status.mutateAsync({requestId:request.id,status:"ACCEPTED"}),"신청곡을 수락했어요")}>수락</Button>}
                  {request.status==="PENDING"&&<Button size="sm" variant="outline" onClick={()=>void run(status.mutateAsync({requestId:request.id,status:"REJECTED"}),"신청곡을 거절했어요")}>거절</Button>}
                  <Button size="sm" variant="outline" onClick={()=>void run(playNow.mutateAsync(request.id),"곡을 재생해요")}>지금 재생</Button>
                  <Button size="sm" variant="ghost" disabled={index===0} onClick={()=>void run(reorder.mutateAsync({requestId:request.id,newOrder:index}),"순서를 바꿨어요")}>↑</Button>
                  <Button size="sm" variant="ghost" disabled={index===requests.length-1} onClick={()=>void run(reorder.mutateAsync({requestId:request.id,newOrder:index+2}),"순서를 바꿨어요")}>↓</Button>
                  <Button size="sm" variant="ghost" onClick={()=>void run(remove.mutateAsync(request.id),"대기열에서 삭제했어요")}>삭제</Button>
                </div>
              </div>
            </li>)}</ol>}
        </section>
        <EndSessionConfirmDialog open={endOpen} onOpenChange={setEndOpen} isPending={end.isPending} onConfirm={()=>{
          if(!sessionId)return;void run(end.mutateAsync(sessionId),"방송을 종료했어요").then(ok=>{if(ok)setEndOpen(false);});
        }} />
      </>}
    </div>
  );
}
