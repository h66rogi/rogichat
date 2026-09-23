export interface SerperVideoSearchRequest {
  query: string;
  num?: number;
}

export interface SerperVideoItem {
  title: string;
  link: string;
  snippet?: string;
  imageUrl?: string;
  duration?: string;
  channel?: string;
  date?: string;
  source?: string;
  position?: number;
}

export interface SerperVideoSearchResponse {
  searchParameters?: {
    q: string;
    gl?: string;
    hl?: string;
    type?: string;
    engine?: string;
    num?: number;
  };
  videos: SerperVideoItem[];
  credits?: number;
}

export interface SerperWebSearchRequest {
  query: string;
  num?: number;
}

export interface SerperWebResultItem {
  title: string;
  link: string;
  snippet?: string;
  domain?: string;
  date?: string;
  position?: number;
}

export interface SerperWebSearchResponse {
  searchParameters?: {
    q: string;
    gl?: string;
    hl?: string;
    type?: string;
    engine?: string;
    num?: number;
  };
  organic: SerperWebResultItem[];
  credits?: number;
}
