import {
  BadRequestException,
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

const SEARCH_DEFAULT_LIMIT = 30;
const SEARCH_MAX_LIMIT = 50;
const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two lat/lng points, in km. Standard haversine — no external geo lib needed for this. */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface SearchListingsInput {
  q?: string;
  scryfallId?: string;
  excludeOwnerId?: string;
  limit?: number;
  /** Searcher's own current position (browser geolocation) — omit to get listings with no distanceKm. */
  lat?: number;
  lng?: number;
}

@Injectable()
export class CardsService {
  constructor(
    @Inject(CARD_REPOSITORY) private readonly cards: CardRepository,
    private readonly storage: StorageService,
  ) {}

  create(ownerId: string, dto: CreateCardDto) {
    return this.cards.create({ ...dto, ownerId });
  }

  findAllForOwner(ownerId: string) {
    return this.cards.findAllByOwner(ownerId);
  }

  /** Bazaar search (E6, ROADMAP.md) — global, not owner-scoped. Requires q or scryfallId so it can't degrade into "list every card ever listed". */
  async searchListings(input: SearchListingsInput) {
    const { q, scryfallId, excludeOwnerId, limit, lat, lng } = input;
    if (!q?.trim() && !scryfallId) {
      throw new BadRequestException('q or scryfallId is required');
    }
    const clampedLimit = Math.min(
      Math.max(limit ?? SEARCH_DEFAULT_LIMIT, 1),
      SEARCH_MAX_LIMIT,
    );
    const listings = await this.cards.searchListings({
      q: q?.trim(),
      scryfallId,
      excludeOwnerId,
      limit: clampedLimit,
    });

    const hasSearcherPosition = lat !== undefined && lng !== undefined;
    return listings.map((listing) => {
      const { ownerLat, ownerLng, ...rest } = listing;
      const distanceKm =
        hasSearcherPosition && ownerLat !== null && ownerLng !== null
          ? haversineKm(lat, lng, ownerLat, ownerLng)
          : null;
      return { ...rest, distanceKm };
    });
  }

  async findOne(id: string) {
    const card = await this.cards.findById(id);
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  /** Same NotFoundException whether the card is missing or belongs to someone else — doesn't confirm a card id exists to a non-owner. */
  private async findOwned(id: string, currentUserId: string) {
    const card = await this.findOne(id);
    if (card.ownerId !== currentUserId)
      throw new NotFoundException('Card not found');
    return card;
  }

  async update(id: string, currentUserId: string, dto: UpdateCardDto) {
    await this.findOwned(id, currentUserId);
    return this.cards.update(id, dto);
  }

  async remove(id: string, currentUserId: string) {
    await this.findOwned(id, currentUserId);
    await this.cards.delete(id);
  }

  // Presigned PUT the Ionic app uploads the photo bytes to directly — the
  // Nest API never touches the binary. `confirmPhoto` below records the key
  // once the upload actually succeeds.
  async createUploadUrl(
    cardId: string,
    currentUserId: string,
    originalFilename: string,
    contentType: string,
  ) {
    await this.findOwned(cardId, currentUserId);
    const key = this.storage.buildKey(`cards/${cardId}`, originalFilename);
    const uploadUrl = await this.storage.getUploadUrl(key, contentType);
    return { key, uploadUrl };
  }

  async confirmPhoto(
    cardId: string,
    currentUserId: string,
    storageKey: string,
    isPrimary = true,
  ) {
    await this.findOwned(cardId, currentUserId);
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
