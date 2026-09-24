export type TotalOverlayWidgetId =
  | 'queue'
  | 'now-playing'
  | 'chatbox'
  | 'alertbox'
  | 'setlist'
  | 'lyrics'
  | 'songbook-qr';

export type TotalOverlayLayoutWidget = {
  id: TotalOverlayWidgetId;
  enabled: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

export type TotalOverlayLayout = {
  version: number;
  aspect: string;
  widgets: TotalOverlayLayoutWidget[];
};

export const DEFAULT_TOTAL_OVERLAY_LAYOUT: TotalOverlayLayout = {
  version: 1,
  aspect: '16:9',
  widgets: [
    {
      id: 'queue',
      enabled: true,
      x: 0.7969,
      y: 0.037,
      w: 0.1823,
      h: 0.6481,
      z: 2,
    },
    {
      id: 'now-playing',
      enabled: true,
      x: 0.0208,
      y: 0.8148,
      w: 0.4167,
      h: 0.1481,
      z: 1,
    },
    {
      id: 'chatbox',
      enabled: false,
      x: 0.0208,
      y: 0.037,
      w: 0.3,
      h: 0.3,
      z: 0,
    },
    {
      id: 'alertbox',
      enabled: false,
      x: 0.35,
      y: 0.037,
      w: 0.3,
      h: 0.2,
      z: 0,
    },
    {
      id: 'setlist',
      enabled: false,
      x: 0.02,
      y: 0.04,
      w: 0.28,
      h: 0.55,
      z: 0,
    },
    {
      id: 'lyrics',
      enabled: false,
      x: 0.25,
      y: 0.7,
      w: 0.5,
      h: 0.25,
      z: 0,
    },
    {
      id: 'songbook-qr',
      enabled: false,
      x: 0.742,
      y: 0.664,
      w: 0.18,
      h: 0.28,
      z: 3,
    },
  ],
};

export const DEFAULT_SYNC_TOTAL_OVERLAY_LAYOUT: TotalOverlayLayout = {
  version: 1,
  aspect: '16:9',
  widgets: [
    {
      id: 'queue',
      enabled: true,
      x: 0.7969,
      y: 0.037,
      w: 0.1823,
      h: 0.6481,
      z: 2,
    },
    {
      id: 'now-playing',
      enabled: true,
      x: 0.0208,
      y: 0.8148,
      w: 0.2083,
      h: 0.1481,
      z: 1,
    },
    {
      id: 'chatbox',
      enabled: false,
      x: 0.0208,
      y: 0.037,
      w: 0.3,
      h: 0.3,
      z: 0,
    },
    {
      id: 'alertbox',
      enabled: false,
      x: 0.35,
      y: 0.037,
      w: 0.3,
      h: 0.2,
      z: 0,
    },
    {
      id: 'setlist',
      enabled: false,
      x: 0.02,
      y: 0.04,
      w: 0.28,
      h: 0.55,
      z: 0,
    },
    {
      id: 'lyrics',
      enabled: false,
      x: 0.25,
      y: 0.7,
      w: 0.5,
      h: 0.25,
      z: 0,
    },
    {
      id: 'songbook-qr',
      enabled: false,
      x: 0.742,
      y: 0.664,
      w: 0.18,
      h: 0.28,
      z: 3,
    },
  ],
};
