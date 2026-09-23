'use client';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/core/runtime/provider';
import type { ChannelWardrobe } from './wardrobe-types';

/** Transport adapter for the Meloming wardrobe response shape. */
export function useChannelWardrobe() {
  const api = useApi();
  const [data,setData] = useState<ChannelWardrobe | null>(null);
  const [isLoading,setIsLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);
  const [revision,setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value+1),[]);
  useEffect(() => {
    const controller = new AbortController();
    api.request<ChannelWardrobe>('/v1/channel/wardrobe',{signal:controller.signal})
      .then(value => { if (!controller.signal.aborted) { setData(value); setError(null); } })
      .catch(() => { if (!controller.signal.aborted) setError('옷장을 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  },[api,revision]);
  return { data, isLoading, error, refresh };
}
