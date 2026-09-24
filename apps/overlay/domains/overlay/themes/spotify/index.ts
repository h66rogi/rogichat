import type { ThemeDefinition } from '../types';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';

const theme: ThemeDefinition = {
  id: 'spotify',
  name: '스포티파이',
  tags: ['spotify', 'dark', 'green'],
  description: '다크 테마, 녹색 강조, 두꺼운 진행바. Spotify 스타일 레이아웃.',
  thumbnail: '/themes/spotify/thumbnail.png',
  widgets: {
    'now-playing': NowPlaying as never,
    queue: Queue as never,
    chatbox: Chatbox as never,
    setlist: Setlist as never,
    lyrics: Lyrics as never,
  } as ThemeDefinition['widgets'],
  fonts: {
    roles: {
      heading: ['Pretendard', 'sans-serif'],
      body: ['Pretendard', 'sans-serif'],
    },
    recommended: [],
    bundled: [],
  },
  optionSchema: [],
  defaultOptions: {},
  presets: [],
  animations: {},
};

export default theme;
