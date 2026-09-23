export type EmoticonStatus = "UPLOADING" | "PENDING" | "APPROVED" | "REJECTED";
export type EmoticonImageType = "STATIC" | "ANIMATED";

export interface ChannelEmoticon {
  id: number;
  shortcode: string;
  imageUrl: string;
  imageType: EmoticonImageType;
  status: EmoticonStatus;
  rejectionReason: string | null;
  uploadedAt: string; // ISO
}

export interface PublicEmoticon {
  id: number;
  shortcode: string;
  imageUrl: string;
  imageType: EmoticonImageType;
  width: number;
  height: number;
}

export interface ReferencedEmoticon {
  shortcode: string;
  imageUrl: string;
  imageType: EmoticonImageType;
  deletedAt: string | null;
  imageDeletedAt: string | null;
}

export type ReferencedEmoticonMap = Record<string, ReferencedEmoticon>;
