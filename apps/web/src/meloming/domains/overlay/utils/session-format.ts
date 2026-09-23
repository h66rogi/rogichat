import { formatDonationAmount as _fmtDonation } from '@/meloming/domains/channel/utils/donation-amount-format';

export const PLATFORM_NAMES: Record<string, string> = {
  CHZZK: '치지직',
  SOOP: '숲',
  TWITCH: '트위치',
  YOUTUBE: '유튜브',
  AFREECA: '아프리카TV',
};

export function formatSessionDuration(minutes: number | null): string {
  if (!minutes) return '-';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${hours}시간 ${mins}분`;
  }
  return `${mins}분`;
}

export function formatDonationAmount(amount: number): string {
  return _fmtDonation({ krwSnapshot: amount });
}
