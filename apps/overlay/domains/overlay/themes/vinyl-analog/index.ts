import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'vinyl-analog',
  name: '아날로그',
  tags: ['vinyl', 'analog', 'retro', 'warm', 'classic', 'vintage'],
  description: 'LP와 턴테이블, 카세트 시대의 감성. 세리프 폰트와 따뜻한 색감으로 음악 자체를 향한 경의를 표하는 테마.',
  thumbnail: '/themes/vinyl-analog/thumbnail.png',
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
