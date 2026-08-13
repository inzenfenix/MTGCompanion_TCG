import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import {
  CARD_REPOSITORY,
  type CardRepository,
} from '../domain/card.repository';
import type { CreateCardDto } from '../presentation/dto/create-card.dto';
import type { UpdateCardDto } from '../presentation/dto/update-card.dto';

@Injectable()
export class CardsService {
  constructor(
    @Inject(CARD_REPOSITORY) private readonly cards: CardRepository,
    private readonly storage: StorageService,
  ) {}

  create(dto: CreateCardDto) {
    return this.cards.create(dto);
  }

  findAllForOwner(ownerId: string) {
    return this.cards.findAllByOwner(ownerId);
  }

  async findOne(id: string) {
    const card = await this.cards.findById(id);
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  async update(id: string, dto: UpdateCardDto) {
    await this.findOne(id);
    return this.cards.update(id, dto);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.cards.delete(id);
  }

  // Presigned PUT the Ionic app uploads the photo bytes to directly — the
  // Nest API never touches the binary. `confirmPhoto` below records the key
  // once the upload actually succeeds.
  async createUploadUrl(
    cardId: string,
    originalFilename: string,
    contentType: string,
  ) {
    await this.findOne(cardId);
    const key = this.storage.buildKey(`cards/${cardId}`, originalFilename);
    const uploadUrl = await this.storage.getUploadUrl(key, contentType);
    return { key, uploadUrl };
  }

  async confirmPhoto(cardId: string, storageKey: string, isPrimary = true) {
    await this.findOne(cardId);
    if (!storageKey.startsWith(`cards/${cardId}/`)) {
      // Guards against a client confirming a key it never got a presigned
      // URL for (e.g. someone else's cardId prefix).
      throw new ForbiddenException('Storage key does not belong to this card');
    }

    if (isPrimary) {
      await this.cards.clearPrimaryPhoto(cardId);
    }

    return this.cards.addPhoto(cardId, storageKey, isPrimary);
  }

  async getPhotoUrl(photoId: string) {
    const photo = await this.cards.findPhotoById(photoId);
    if (!photo) throw new NotFoundException('Photo not found');
    return { url: await this.storage.getDownloadUrl(photo.storageKey) };
  }
}
