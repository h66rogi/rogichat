import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'concert-poster',
  name: '콘서트 포스터',
  tags: ['poster', 'bold', 'purple', 'high-contrast', 'typographic', 'event'],
  description:
    '콘서트 포스터/페스티벌 라인업 톤. 보라 액센트 + 부드러운 드롭 섀도우 + 액센트 stroke. 곡명 강조 + REQUESTED + NEXT 표기.',
  thumbnail: '/themes/concert-poster/thumbnail.svg',
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
