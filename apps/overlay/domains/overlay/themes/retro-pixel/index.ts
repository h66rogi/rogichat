import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'retro-pixel',
  name: '레트로',
  tags: ['retro', 'dark', 'pixel', 'neon', 'gaming'],
  description: '8-bit 게임 콘솔 시대의 감성. CRT 모니터에서 보는 듯한 느낌.',
  thumbnail: '/themes/retro-pixel/thumbnail.png',
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
