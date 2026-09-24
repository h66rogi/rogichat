import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'kawaii',
  name: '카와이',
  tags: ['kawaii', 'cute', 'pastel', 'y2k', 'anime', 'girly'],
  description:
    '2000년대 인터넷 감성. 파스텔 핑크-라벤더-민트, 별과 하트 장식, 둥글둥글한 폰트와 그라데이션 언더라인. 체리블라썸 & 라벤더 드림 바이브.',
  thumbnail: '/themes/kawaii/thumbnail.png',
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
  cssVariables: config.cssVariables,
  performance: config.performance,
};

export default theme;
