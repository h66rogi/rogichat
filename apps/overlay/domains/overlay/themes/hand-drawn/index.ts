import type { ThemeDefinition } from '../types';
import config from './config';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Chatbox from './Chatbox';
import Setlist from './Setlist';
import Lyrics from './Lyrics';
import './animations.css';

const theme: ThemeDefinition = {
  id: 'hand-drawn',
  name: '핸드스케치',
  tags: ['handdrawn', 'sketch', 'warm', 'personal', 'notebook', 'diary'],
  description:
    '손으로 그린 노트북/다이어리 감성. 따뜻한 베이지 종이, 핸드라이팅 폰트, 핀과 테이프, 살짝 기울어진 카드로 개인적이고 포근한 분위기.',
  thumbnail: '/themes/hand-drawn/thumbnail.png',
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
