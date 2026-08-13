import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CardsService } from '../application/cards.service';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { RequestUploadUrlDto } from './dto/upload-url.dto';
import { ConfirmPhotoDto } from './dto/confirm-photo.dto';

@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Post()
  create(@Body() dto: CreateCardDto) {
    return this.cards.create(dto);
  }

  // ?ownerId=... is a stand-in for a JWT-derived owner until the auth pass
  // lands (see CreateCardDto's comment on the same gap).
  @Get()
  findAll(@Query('ownerId') ownerId: string) {
    return this.cards.findAllForOwner(ownerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cards.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCardDto) {
    return this.cards.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cards.remove(id);
  }

  // Two-step upload: get a presigned PUT, client PUTs bytes straight to
  // storage, then confirms so the photo is recorded against the card.
  @Post(':id/photos/upload-url')
  createUploadUrl(@Param('id') id: string, @Body() dto: RequestUploadUrlDto) {
    return this.cards.createUploadUrl(id, dto.filename, dto.contentType);
  }

  @Post(':id/photos')
  confirmPhoto(@Param('id') id: string, @Body() dto: ConfirmPhotoDto) {
    return this.cards.confirmPhoto(id, dto.storageKey, dto.isPrimary);
  }

  @Get('photos/:photoId/url')
  getPhotoUrl(@Param('photoId') photoId: string) {
    return this.cards.getPhotoUrl(photoId);
  }
}
