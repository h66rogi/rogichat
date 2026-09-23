import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { CategoryService } from './category.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateCategoryDto,
  SwapCategoryOrderDto,
  UpdateCategoryDto,
} from './dto/category.request.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import {
  CategoryDto,
  CategoryListItemDto,
  DeleteCategoryResponseDto,
} from './dto/category.response.dto';
import {
  toCategoryDto,
  toCategoryListItemDto,
} from './mappers/category.mapper';
import { ChannelPermission } from '../channel/guards/channel-permission.decorator';
import { ChannelPermissionGuard } from '../channel/guards/channel-permission.guard';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get('public/:webPath')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '공개 노래책의 카테고리 목록 조회',
    description:
      '카테고리는 displayOrder가 있는 것이 우선 정렬되며 (큰 숫자 먼저), displayOrder가 null인 경우 생성일 순으로 정렬됩니다.',
  })
  @ApiParam({
    name: 'webPath',
    description: '채널 주소',
    example: 'meloming_user',
  })
  @ApiResponse({
    status: 200,
    description: '카테고리 목록 반환',
    type: CategoryListItemDto,
    isArray: true,
  })
  @ApiResponse({ status: 404, description: '사용자를 찾을 수 없음' })
  async getPublicCategories(@Param('webPath') webPath: string) {
    const items = await this.categoryService.getCategoriesByWebPath(webPath);
    return items.map((c) => toCategoryListItemDto(c));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Get('/channel/:channelId/categories')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '특정 뮤직북의 카테고리 목록 조회',
    description:
      '카테고리는 displayOrder가 있는 것이 우선 정렬되며 (큰 숫자 먼저), displayOrder가 null인 경우 생성일 순으로 정렬됩니다.',
  })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '카테고리 목록 조회 성공',
    type: CategoryListItemDto,
    isArray: true,
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '뮤직북을 찾을 수 없음' })
  async getCategoriesByChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
  ) {
    const items =
      await this.categoryService.getCategoriesByChannelId(channelId);
    return items.map((c) => toCategoryListItemDto(c));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post('/channel/:channelId/categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '특정 뮤직북에 카테고리 추가' })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiResponse({
    status: 201,
    description: '카테고리 생성 성공',
    type: CategoryDto,
  })
  @ApiBody({ type: CreateCategoryDto })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({ status: 404, description: '뮤직북을 찾을 수 없음' })
  async createCategoryInChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    const created = await this.categoryService.createCategoryByChannelId(
      createCategoryDto,
      channelId,
    );
    return toCategoryDto({
      id: created.id,
      name: created.name,
      color: created.color,
      channelId: created.channelId,
      price: created.price,
      currencyPrices: created.currencyPrices,
      displayOrder: created.displayOrder,
      createdAt: created.createdAt,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Put('/channel/:channelId/categories/:categoryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '특정 뮤직북의 카테고리 수정' })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiParam({
    name: 'categoryId',
    type: Number,
    description: '카테고리 ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '카테고리 수정 성공',
    type: CategoryDto,
  })
  @ApiBody({ type: UpdateCategoryDto })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({
    status: 404,
    description: '카테고리 또는 뮤직북을 찾을 수 없음',
  })
  async updateCategoryInChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    const updated = await this.categoryService.updateCategoryByChannelId(
      categoryId,
      updateCategoryDto,
      channelId,
    );
    return toCategoryDto({
      id: updated.id,
      name: updated.name,
      color: updated.color,
      channelId: updated.channelId,
      price: updated.price,
      currencyPrices: updated.currencyPrices,
      displayOrder: updated.displayOrder,
      createdAt: updated.createdAt,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Post('/channel/:channelId/categories/swap-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '특정 뮤직북의 두 카테고리 순서를 교환' })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '카테고리 순서 교환 성공',
    type: CategoryDto,
    isArray: true,
  })
  @ApiBody({ type: SwapCategoryOrderDto })
  @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({
    status: 404,
    description: '카테고리 또는 뮤직북을 찾을 수 없음',
  })
  async swapCategoryOrderInChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() swapCategoryOrderDto: SwapCategoryOrderDto,
  ) {
    const updatedCategories =
      await this.categoryService.swapCategoryOrderByChannelId(
        swapCategoryOrderDto.categoryId,
        swapCategoryOrderDto.targetCategoryId,
        channelId,
      );

    return updatedCategories.map((category) =>
      toCategoryDto({
        id: category.id,
        name: category.name,
        color: category.color,
        channelId: category.channelId,
        price: category.price,
        currencyPrices: category.currencyPrices,
        displayOrder: category.displayOrder,
        createdAt: category.createdAt,
      }),
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, ChannelPermissionGuard)
  @ChannelPermission('content')
  @Delete('/channel/:channelId/categories/:categoryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '특정 뮤직북의 카테고리 삭제' })
  @ApiParam({
    name: 'channelId',
    type: Number,
    description: '뮤직북 ID',
    example: 1,
  })
  @ApiParam({
    name: 'categoryId',
    type: Number,
    description: '카테고리 ID',
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: '카테고리 삭제 성공',
    type: DeleteCategoryResponseDto,
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '뮤직북 접근 권한 없음' })
  @ApiResponse({
    status: 404,
    description: '카테고리 또는 뮤직북을 찾을 수 없음',
  })
  async deleteCategoryFromChannel(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('categoryId', ParseIntPipe) categoryId: number,
  ) {
    return this.categoryService.deleteCategoryByChannelId(
      categoryId,
      channelId,
    );
  }
}
