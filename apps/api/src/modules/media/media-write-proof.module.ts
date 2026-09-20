import { Module } from '@nestjs/common';
import { MediaWriteProofRepository } from './media-write-proof.repository.js';
import { MediaWriteProofService } from './media-write-proof.service.js';
@Module({ providers: [MediaWriteProofRepository, MediaWriteProofService], exports: [MediaWriteProofService] })
export class MediaWriteProofModule {}
