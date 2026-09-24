import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: '3d-depth',
  name: '3D Depth',
  tags: ['3d', 'depth', 'dimensional', 'layered', 'modern'],
  description:
    'CSS 3D 변환과 원근감. 기울어진 카드, 깊은 다중 레이어 그림자, 입체적으로 떠 있는 레이어드 무드.',
  thumbnail: '/themes/3d-depth/thumbnail.png',
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
