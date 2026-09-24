import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'glassmorphism',
  name: '글래스모피즘',
  tags: ['glass', 'modern', 'frosted', 'minimal', 'gradient'],
  description:
    '반투명 유리 카드, 블러 배경, 미묘한 그라데이션. Apple의 현대적 미학 확장.',
  thumbnail: '/themes/glassmorphism/thumbnail.png',
  widgets: {
    'now-playing': NowPlaying as never,
    queue: Queue as never,
    chatbox: Chatbox as never,
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
