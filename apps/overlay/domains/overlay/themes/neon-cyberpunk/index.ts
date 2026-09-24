import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'neon-cyberpunk',
  name: '네온',
  tags: ['neon', 'cyberpunk', 'dark', 'futuristic', 'glow'],
  description: '한밤의 메가시티 네온사인. 마젠타와 시안 위로 글로우가 번지는 사이버펑크 감성.',
  thumbnail: '/themes/neon-cyberpunk/thumbnail.png',
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
