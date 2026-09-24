import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'brutalist',
  name: '브루탈리스트',
  tags: ['brutalist', 'raw', 'bold', 'monochrome', 'high-contrast'],
  description:
    '반(反)미니멀리즘. 두꺼운 블랙 보더, 하드 드롭 섀도우, 기울어진 태그, 흑백 + 형광 옐로우 포인트.',
  thumbnail: '/themes/brutalist/thumbnail.png',
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
