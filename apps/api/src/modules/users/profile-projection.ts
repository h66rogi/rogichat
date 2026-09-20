export interface VisibleActorProfileReadModel {
  readonly actorId: string;
  readonly nickname: string;
  readonly avatar: { readonly assetId: string } | null;
  readonly role: 'FAN' | 'MEMBER' | 'STREAMER';
  // Populate only after viewer-specific authorization. A raw stored birthday
  // is deliberately NOT a field of this read model.
  readonly visibleBirthday?: { readonly month: number; readonly day: number } | null;
}
export interface ActorProfileDto {
  actorId: string;
  nickname: string;
  avatar: { assetId: string } | null;
  role: 'FAN' | 'MEMBER' | 'STREAMER';
  birthday?: { month: number; day: number };
}

// Pure projection, not a privacy decision. Caller supplies only fields visible in
// its fresh authorized snapshot and computes the viewer-specific revision AFTER
// projection. This mapper never copies private fields or stored profile revisions.
export function projectActorProfileDto(model: VisibleActorProfileReadModel): ActorProfileDto {
  const projection: ActorProfileDto = {
    actorId: model.actorId, nickname: model.nickname,
    avatar: model.avatar === null ? null : { assetId: model.avatar.assetId }, role: model.role,
  };
  if (Object.hasOwn(model, 'visibleBirthday') && model.visibleBirthday !== undefined && model.visibleBirthday !== null) {
    projection.birthday = { month: model.visibleBirthday.month, day: model.visibleBirthday.day };
  }
  return projection;
}
