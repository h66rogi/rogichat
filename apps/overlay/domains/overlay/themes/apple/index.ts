import type { ThemeDefinition } from '../types';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';

const theme: ThemeDefinition = {
  id: 'apple',
  name: '애플 뮤직',
  tags: ['apple', 'minimal', 'blur'],
  description: '미니멀, 블러 배경, 둥근 모서리. Apple Music 스타일 레이아웃.',
  thumbnail: '/themes/apple/thumbnail.png',
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
