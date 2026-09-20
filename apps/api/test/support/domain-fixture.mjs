import { MediaWriteProofService } from '../../dist/modules/media/media-write-proof.service.js';
import { MediaWriteProofModule } from '../../dist/modules/media/media-write-proof.module.js';
import { AccountDeletionRepository } from '../../dist/modules/deletion/account-deletion.repository.js';
import { IdentityGuardRepository } from '../../dist/modules/auth/identity-guard.repository.js';
import { IdentityGuardService } from '../../dist/modules/auth/identity-guard.service.js';
import { DeletionRepository } from '../../dist/modules/deletion/deletion.repository.js';
import { deletionFixture } from './deletion-fixture.mjs';
import { DeletionApplyService } from '../../dist/modules/deletion/deletion-apply.service.js';

import { newIntentScope } from './membership-scope-fixture.mjs';
import { sendInput as parseSendInput } from '../../dist/modules/messages/dto/send-message.dto.js';
// Fixtures use the real Nest domain graph. No alternative domain implementation lives here.
import 'reflect-metadata';
import { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AccessService } from '../../dist/modules/access/access.service.js';
import { MessagesCoreModule } from '../../dist/modules/messages/messages-core.module.js';
import { MessagesCoreService } from '../../dist/modules/messages/messages-core.service.js';
import { UsersCoreModule } from '../../dist/modules/users/users-core.module.js';
import { UsersCoreService } from '../../dist/modules/users/users-core.service.js';
import { RoomStateModule } from '../../dist/modules/rooms/room-state.module.js';
import { RoomStateService } from '../../dist/modules/rooms/room-state.service.js';
import { ReactionsCoreModule } from '../../dist/modules/reactions/reactions-core.module.js';
import { ReactionsCoreService } from '../../dist/modules/reactions/reactions-core.service.js';
import { PublicationsCoreModule } from '../../dist/modules/publications/publications-core.module.js';
import { PublicationsCoreService } from '../../dist/modules/publications/publications-core.service.js';
import { MediaCoreModule } from '../../dist/modules/media/media-core.module.js';
import { MediaCoreService } from '../../dist/modules/media/media-core.service.js';
import { RoomMediaCoreService } from '../../dist/modules/media/room-media-core.service.js';
import { JobsCoreModule } from '../../dist/modules/jobs/jobs-core.module.js';
import { JobsCoreService } from '../../dist/modules/jobs/jobs-core.service.js';
import { JobsRepository } from '../../dist/modules/jobs/jobs.repository.js';
import { Jobs as Queue } from '../../dist/modules/jobs/jobs.service.js';
import { MediaWorkerRepository } from '../../dist/modules/media/media-worker.repository.js';
import { MediaWorkerService } from '../../dist/modules/media/media-worker.service.js';
import { StickersCoreModule } from '../../dist/modules/stickers/stickers-core.module.js';
import { StickersCoreService } from '../../dist/modules/stickers/stickers-core.service.js';
class DomainFixtureModule {}
Module({ imports: [MediaWriteProofModule, MessagesCoreModule, UsersCoreModule, RoomStateModule, ReactionsCoreModule, PublicationsCoreModule, MediaCoreModule, JobsCoreModule, StickersCoreModule], providers: [MediaWorkerRepository] })(DomainFixtureModule);
const context = await NestFactory.createApplicationContext(DomainFixtureModule, { logger: false, abortOnError: false });
after(() => context.close());
const bind = (token, name) => context.get(token)[name].bind(context.get(token));
export const sendMessageScoped = bind(MessagesCoreService, 'send');
export const sendMessage = async (tx, roomId, userId, input, key) => {
  const scoped = { ...input, membershipScope: await newIntentScope(tx, key, 'domain-fixture', userId, roomId) };
  return context.get(MessagesCoreService).send(tx, roomId, userId, scoped, key, 'domain-fixture');
};
export const getMessage = bind(MessagesCoreService, 'get');
export async function deleteMessage(transactions, room, actor, message, authorize = async () => {}) {
  const core = context.get(MessagesCoreService);
  const { ledger } = deletionFixture();
  const intent = await transactions.write(async tx => { await authorize(tx); return core.authorizeDeletion(tx, room, actor, message, 'qa'); });
  return new DeletionApplyService(transactions, core, new DeletionRepository(), new AccountDeletionRepository(), new IdentityGuardService(new IdentityGuardRepository())).apply(await ledger.ensureIntent(intent));
}
export const loadMessage = bind(MessagesCoreService, 'load');
export const readable = bind(MessagesCoreService, 'readable');
export const recordMessageEvent = bind(MessagesCoreService, 'recordEvent');
export const selfProfile = bind(UsersCoreService, 'selfProfile');
export const updateProfile = bind(UsersCoreService, 'updateProfile');
export const roomProfile = bind(UsersCoreService, 'roomProfile');
export const profileManifest = bind(UsersCoreService, 'profileManifest');
export const activeMember = bind(AccessService, 'requireActiveMember');
export const actorBlocked = bind(AccessService, 'actorBlocked');
export const createRoom = bind(RoomStateService, 'createRoom');
// Explicit isolated provisioning: callers choose an existing member, never send admission.
export async function assignRoomOwner(tx, roomId, actorId) {
  await tx.prisma.room_members.update({ where: { id: actorId }, data: { role: 'STREAMER' }, select: { id: true } });
  await tx.prisma.rooms.update({ where: { id: roomId }, data: { owner_member_id: actorId }, select: { id: true } });
}
export const joinRoom = bind(RoomStateService, 'joinRoom');
export const leaveRoom = bind(RoomStateService, 'leaveRoom');
export const lockRoom = bind(RoomStateService, 'lockRoom');
export const nextOrder = bind(RoomStateService, 'nextOrder');
export const readReactions = bind(ReactionsCoreService, 'readReactions');
export const setReaction = bind(ReactionsCoreService, 'setReaction');
export const requestPublication = bind(PublicationsCoreService, 'requestPublication');
export const publicationStatus = bind(PublicationsCoreService, 'publicationStatus');
export const publishText = bind(PublicationsCoreService, 'publishText');
export const reserveMedia = bind(MediaCoreService, 'reserveMedia');
export const mediaStatus = bind(MediaCoreService, 'mediaStatus');
export const beginUpload = bind(MediaCoreService, 'beginUpload');
export const finishUpload = bind(MediaCoreService, 'finishUpload');
export const failUpload = bind(MediaCoreService, 'failUpload');
export const authorizedMediaObject = bind(MediaCoreService, 'authorizedMediaObject');
export const readRoomMediaPolicy = bind(RoomMediaCoreService, 'readRoomMediaPolicy');
export const setRoomMediaPolicy = bind(RoomMediaCoreService, 'setRoomMediaPolicy');
export const requireRoomMedia = bind(RoomMediaCoreService, 'requireRoomMedia');
export const enqueueJob = bind(JobsCoreService, 'enqueue');
export const completeJob = bind(JobsCoreService, 'complete');
export const users = context.get(UsersCoreService);
export const stickers = context.get(StickersCoreService);
export function Jobs(transactions, consumer, ownerId) { return new Queue(transactions, consumer, context.get(JobsRepository), context.get(JobsCoreService), ownerId); }
const worker = (transactions, store, decoder, prefix) => new MediaWorkerService(transactions, store, decoder, prefix, context.get(MediaWorkerRepository), context.get(JobsCoreService), context.get(AccessService), context.get(MessagesCoreService), context.get(MediaWriteProofService));
export const processMedia = (transactions, store, decoder, prefix, lease) => worker(transactions, store, decoder, prefix).processMedia(lease);
export const prepareMedia = (tx, lease, prefix) => worker(undefined, undefined, undefined, prefix).prepareMedia(tx, lease);
export const recoverMedia = tx => worker().recoverMedia(tx);
export async function createUser(tx, nickname) {
  const id = randomUUID();
  await tx.execute('INSERT INTO users (id) VALUES (?)', [id]);
  await tx.execute('INSERT INTO user_profiles (user_id,nickname) VALUES (?,?)', [id, nickname]);
  return id;
}
export { consumeRate, collectExpiredRates } from '../../dist/infrastructure/rate-limit/rate-limit.repository.js';
export { uuid, identifier } from '../../dist/common/validation/identifier.js';
export const sendInput = body => parseSendInput({ membershipScope: 'A'.repeat(43), ...body });
export { reactionEmoji } from '../../dist/modules/reactions/dto/reaction.dto.js';
export { syncInput } from '../../dist/modules/sync/dto/sync.dto.js';
export { resetSync } from '../../dist/modules/sync/sync-core.service.js';
export { JobFailure, runClaimedJob } from '../../dist/modules/jobs/jobs.service.js';
export * from '../../dist/modules/jobs/jobs.policy.js';
