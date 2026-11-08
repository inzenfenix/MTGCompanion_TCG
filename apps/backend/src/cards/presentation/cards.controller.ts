import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/presentation/optional-jwt-auth.guard';
import {
  AuditAccess,
  setAuditContext,
} from '../../common/audit/audit-access.decorator';
import { SearchPositionTracker } from '../application/search-position-tracker';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import type { CardOrigin } from '../../../generated/prisma';
import { CardsService } from '../application/cards.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { RequestUploadUrlDto } from './dto/upload-url.dto';
import { ConfirmPhotoDto } from './dto/confirm-photo.dto';

@Controller('cards')
export class CardsController {
  constructor(
    private readonly cards: CardsService,
    private readonly positions: SearchPositionTracker,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @AuditAccess({
    action: 'market.card.create',
    resourceType: 'card',
    resourceRef: (r) => (r as { id?: string }).id,
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCardDto) {
    return this.cards.create(user.id, dto);
  }

  // Two modes on one resource, picked by which query params are present:
  //   ?ownerId=...                 -> unchanged owner-scoped browse (Vault)
  //                                    optionally ?origin=VAULT (Tab3.tsx's
  //                                    collection view, ROADMAP.md J3) to
  //                                    hide SCAN_LISTING-only rows, and
  //                                    optionally ?deckId=<id>|unsorted
  //                                    (ROADMAP.md K) to scope to one deck
  //                                    or to cards with no deck at all —
  //                                    omitted means every card regardless
  //                                    of deck, same "omitted = no filter"
  //                                    contract origin already has.
  //   ?q=...|scryfallId=...        -> global Bazaar search (E6), optionally
  //                                    ?lat=&lng= (searcher's own position,
  //                                    for distanceKm) and
  //                                    ?excludeOwnerId= (hide your own cards)
  // Both are public — browsing anyone's listed cards, or the marketplace at
  // large, doesn't require being logged in as them.
  // O17 (ACTIVIDAD_7.md §2, §4): the distance to each seller is computed
  // from their (special-category) location, so it's only computed for a
  // logged-in searcher — every such search is then an attributable access,
  // logged with how many distances it produced and whether the searcher
  // "jumped" to a new ~1 km cell (never the coordinates themselves).
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @AuditAccess({
    action: 'access.location.distance',
    resourceType: 'card-search',
    when: (req) =>
      !!req.user &&
      req.query.lat !== undefined &&
      req.query.lng !== undefined &&
      !req.query.ownerId,
  })
  async findAll(
    @Req() req: unknown,
    @CurrentUser() user?: RequestUser,
    @Query('ownerId') ownerId?: string,
    @Query('origin') origin?: CardOrigin,
    @Query('deckId') deckId?: string,
    @Query('q') q?: string,
    @Query('scryfallId') scryfallId?: string,
    @Query('excludeOwnerId') excludeOwnerId?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('limit') limit?: string,
  ) {
    if (ownerId) return this.cards.findAllForOwner(ownerId, origin, deckId);
    if (!q && !scryfallId) {
      throw new BadRequestException('ownerId, q, or scryfallId is required');
    }
    const withPosition = !!user && lat !== undefined && lng !== undefined;
    const listings = await this.cards.searchListings({
      q,
      scryfallId,
      excludeOwnerId,
      limit: limit ? Number(limit) : undefined,
      lat: withPosition ? Number(lat) : undefined,
      lng: withPosition ? Number(lng) : undefined,
    });
    if (withPosition) {
      const sellers = listings.filter((l) => l.distanceKm !== null).length;
      const moved = this.positions.observe(user.id, Number(lat), Number(lng));
      setAuditContext(req, {
        reason: `sellers=${sellers}${moved ? ';new-position' : ''}`,
      });
    }
    return listings;
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cards.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateCardDto,
  ) {
    return this.cards.update(id, user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @AuditAccess({
    action: 'market.card.delete',
    resourceType: 'card',
    param: 'id',
  })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.cards.remove(id, user.id);
  }

  // Two-step upload: get a presigned PUT, client PUTs bytes straight to
  // storage, then confirms so the photo is recorded against the card.
  @UseGuards(JwtAuthGuard)
  @Post(':id/photos/upload-url')
  createUploadUrl(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RequestUploadUrlDto,
  ) {
    return this.cards.createUploadUrl(
      id,
      user.id,
      dto.filename,
      dto.contentType,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/photos')
  confirmPhoto(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ConfirmPhotoDto,
  ) {
    return this.cards.confirmPhoto(id, user.id, dto.storageKey, dto.isPrimary);
  }

  @Get('photos/:photoId/url')
  getPhotoUrl(@Param('photoId') photoId: string) {
    return this.cards.getPhotoUrl(photoId);
  }

  // ROADMAP.md J4 — seller-only, mints the token a generated QR encodes.
  @UseGuards(JwtAuthGuard)
  @Post(':id/listing-token')
  createListingToken(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.cards.createListingToken(id, user.id);
  }

  // Public — the Buy page (J5) resolves a scanned QR's token before
  // rendering anything. Two segments (unlike the single-segment `:id`
  // above), so no route-matching ambiguity between the two.
  @Get('listing-token/:token')
  resolveListingToken(@Param('token') token: string) {
    return { cardId: this.cards.resolveListingToken(token) };
  }
}
