import type { ThemeDefinition } from '../types';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';

const theme: ThemeDefinition = {
  id: 'billboard',
  name: '빌보드',
  tags: ['billboard', 'bold', 'text-only', 'transparent'],
  description: '투명 배경, 큰 Bold 텍스트만. Billboard 스타일 레이아웃.',
  thumbnail: '/themes/billboard/thumbnail.png',
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
