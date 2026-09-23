export interface ImageSearchRequest {
  title: string;
  artist: string;
}

export interface ImageSearchItem {
  title: string;
  imageUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  source?: string;
  domain?: string;
  link?: string;
  googleUrl?: string;
  position?: number;
}

export interface ImageSearchResponse {
  searchParameters: {
    q: string;
    gl?: string;
    hl?: string;
    type?: string;
    engine?: string;
    num?: number;
  };
  images: ImageSearchItem[];
  credits?: number;
  allowable_urls?: string[];
}
