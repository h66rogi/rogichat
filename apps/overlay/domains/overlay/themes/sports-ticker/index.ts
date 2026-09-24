import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'sports-ticker',
  name: '스포츠 티커',
  tags: ['sports', 'broadcast', 'news', 'professional', 'ticker'],
  description:
    'TV 방송국 로어 써드 스타일. LIVE 뱃지와 흐르는 티커, 뉴스 채널 같은 풀폭 하단 바.',
  thumbnail: '/themes/sports-ticker/thumbnail.svg',
  widgets: {
    'now-playing': NowPlaying,
    queue: Queue,
    chatbox: Chatbox,
    setlist: Setlist as never,
    lyrics: Lyrics as never,
  } as ThemeDefinition['widgets'],
  fonts: config.fonts,
  optionSchema: config.optionSchema,
  defaultOptions: config.defaultOptions,
  presets: config.presets,
  animations: config.animations,
  cssVariables: config.cssVariables,
  performance: config.performance,
};

export default theme;
