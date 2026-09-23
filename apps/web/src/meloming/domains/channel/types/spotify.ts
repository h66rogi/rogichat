export interface SpotifySearchRequest {
  title: string;
  artist: string;
}

export interface SpotifySearchItem {
  title: string;
  artist: string;
  album: string;
  albumArt: string;
  spotifyUrl: string;
  previewUrl: string | null;
}

export interface SpotifySearchResponse {
  results: SpotifySearchItem[];
}
