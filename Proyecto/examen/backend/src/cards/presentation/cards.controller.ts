import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { RequestUser } from '../../auth/presentation/jwt.strategy';
import { CardsService } from '../application/cards.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { RequestUploadUrlDto } from './dto/upload-url.dto';
import { ConfirmPhotoDto } from './dto/confirm-photo.dto';

@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCardDto) {
    return this.cards.create(user.id, dto);
  }

  // ?ownerId=... — public browse (marketplace: viewing anyone's listed
  // cards doesn't require being logged in as them).
  @Get()
  findAll(@Query('ownerId') ownerId: string) {
    return this.cards.findAllForOwner(ownerId);
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
}
