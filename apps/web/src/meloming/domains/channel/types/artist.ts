/**
 * Domain
 */

export interface Artist {
  id: number;
  name: string;
  channelId: number;
  createdAt: string;
  songCount: number;
  channel: {
    id: number;
    name: string;
    user: {
      id: number;
      nickname: string;
    };
  };
}

/**
 * Dto
 */

export type GetArtistsPublicWebPathResponse = Artist[];

export type GetArtistsChannelChannelIdArtistsResponse = Artist[];

export interface PostArtistsChannelChannelIdArtistsRequestBody {
  name: string;
}

export type PostArtistsChannelChannelIdArtistsResponse = Pick<
  Artist,
  "id" | "name" | "channelId" | "createdAt"
>;

export type PutArtistsChannelChannelIdArtistsArtistsIdRequestBody =
  PostArtistsChannelChannelIdArtistsRequestBody;

export type PutArtistsChannelChannelIdArtistsArtistsIdResponse = Pick<
  Artist,
  "id" | "name" | "channelId" | "createdAt"
>;

export interface DeleteArtistsChannelChannelIdArtistsArtistsIdResponse {
  message: string;
}
