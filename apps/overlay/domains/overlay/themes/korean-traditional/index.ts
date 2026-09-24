import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'korean-traditional',
  name: '한국 전통',
  tags: ['korean', 'traditional', 'serif', 'warm', 'elegant', 'hanji'],
  description:
    '한국 전통 미감의 현대적 재해석. 한지 텍스처, 세리프 서체, 단청 색상, 전통 문양과 도장으로 따뜻하고 우아한 분위기.',
  thumbnail: '/themes/korean-traditional/thumbnail.png',
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
  performance: config.performance,
};

export default theme;
