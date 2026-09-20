export interface MessageAttachmentReadModel {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
  readonly variant: string;
}
export interface MessageReadModel {
  readonly id: string;
  readonly version: string | bigint;
  readonly createdAt: Date;
  readonly audience: 'SHARED' | 'PRIVATE';
  readonly author: { readonly kind: 'anonymous' } | {
    readonly kind: 'member'; readonly actorId: string; readonly nickname: string | null;
    readonly avatar: { readonly assetId: string } | null;
  };
  readonly content: { readonly type: 'TEXT'; readonly text: string | null } | {
    readonly type: 'PHOTO' | 'VIDEO' | 'STICKER';
    readonly attachments: readonly MessageAttachmentReadModel[];
  };
  readonly quote: { readonly id: string; readonly content: { readonly type: 'TEXT'; readonly text: string } } | null;
}

export interface MessageDto {
  id: string; version: string; createdAt: string; audience: 'SHARED' | 'PRIVATE';
  author: { kind: 'anonymous' } | { kind: 'member'; actorId: string; nickname: string; avatar: { assetId: string } | null };
  content: { type: 'TEXT'; text: string | null } | {
    type: 'PHOTO' | 'VIDEO' | 'STICKER'; attachments: { assetId: string; width: number; height: number; variant: string }[];
  };
  quote: { id: string; content: { type: 'TEXT'; text: string } } | null;
}

// Projection only: the caller must construct this model after fresh authorization,
// quote-audience checks and attachment filtering on its SAME transaction snapshot.
// No row spreading: extra internal IDs, object keys and private facts never become DTO fields.
export function projectMessageDto(model: MessageReadModel): MessageDto {
  let author: MessageDto['author'];
  if (model.author.kind === 'anonymous') author = { kind: 'anonymous' };
  else if (model.author.kind === 'member') {
    author = { kind: 'member', actorId: model.author.actorId, nickname: model.author.nickname ?? '사용자',
      avatar: model.author.avatar === null ? null : { assetId: model.author.avatar.assetId } };
  } else throw new Error('invalid_message_read_model');

  let content: MessageDto['content'];
  if (model.content.type === 'TEXT') content = { type: 'TEXT', text: model.content.text };
  else if (['PHOTO', 'VIDEO', 'STICKER'].includes(model.content.type)) {
    content = { type: model.content.type, attachments: model.content.attachments.map(attachment => ({
      assetId: attachment.assetId, width: attachment.width, height: attachment.height, variant: attachment.variant,
    })) };
  } else throw new Error('invalid_message_read_model');

  return { id: model.id, version: String(model.version), createdAt: model.createdAt.toISOString(), audience: model.audience,
    author, content, quote: model.quote === null ? null : { id: model.quote.id, content: { type: 'TEXT', text: model.quote.content.text } } };
}
