import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelManagerService } from './channel-manager.service';
import {
  AddManagerDto,
  UpdateManagerActiveDto,
  UpdateManagerPermissionsDto,
  ManagerDto,
  ManagerListResponseDto,
  ToggleManagerActiveResponseDto,
} from './dto/channel-manager.dto';

@ApiTags('Channel Managers')
@Controller('channels/:channelId/managers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ChannelManagerController {
  constructor(private readonly managerService: ChannelManagerService) {}

  @Get()
  @ApiOperation({
    summary: '매니저 목록 조회',
    description:
      '채널의 매니저 목록을 조회합니다. 구독 상태에 따른 최대 활성 매니저 수 정보도 포함됩니다.',
  })
  @ApiParam({ name: 'channelId', description: '채널 ID' })
  @ApiResponse({ status: 200, type: ManagerListResponseDto })
  @ApiResponse({ status: 403, description: '접근 권한 없음' })
  @ApiResponse({ status: 404, description: '채널을 찾을 수 없음' })
  async listManagers(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Request() req,
  ): Promise<ManagerListResponseDto> {
    return this.managerService.listManagers(channelId, req.user.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '매니저 추가',
    description:
      '새로운 매니저를 추가합니다. 채널 소유자만 가능합니다. 활성 매니저 수 제한에 걸리면 비활성 상태로 추가됩니다.',
  })
  @ApiParam({ name: 'channelId', description: '채널 ID' })
  @ApiResponse({ status: 201, type: ManagerDto })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (자기 자신 추가, 이미 등록됨)',
  })
  @ApiResponse({ status: 403, description: '채널 소유자만 가능' })
  @ApiResponse({ status: 404, description: '채널 또는 사용자를 찾을 수 없음' })
  async addManager(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Body() dto: AddManagerDto,
    @Request() req,
  ): Promise<ManagerDto> {
    return this.managerService.addManager(channelId, req.user.id, dto);
  }

  @Patch(':managerId/active')
  @ApiOperation({
    summary: '매니저 활성화/비활성화',
    description:
      '매니저의 활성화 상태를 변경합니다. 비구독자의 경우 다른 매니저를 활성화하면 기존 활성 매니저가 자동으로 비활성화됩니다.',
  })
  @ApiParam({ name: 'channelId', description: '채널 ID' })
  @ApiParam({ name: 'managerId', description: '매니저 ID' })
  @ApiResponse({ status: 200, type: ToggleManagerActiveResponseDto })
  @ApiResponse({
    status: 400,
    description: '최대 활성 매니저 수 초과 (구독자)',
  })
  @ApiResponse({ status: 403, description: '채널 소유자만 가능' })
  @ApiResponse({ status: 404, description: '매니저를 찾을 수 없음' })
  async toggleManagerActive(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('managerId', ParseIntPipe) managerId: number,
    @Body() dto: UpdateManagerActiveDto,
    @Request() req,
  ): Promise<ToggleManagerActiveResponseDto> {
    return this.managerService.toggleManagerActive(
      channelId,
      managerId,
      req.user.id,
      dto.isActive,
    );
  }

  @Patch(':managerId/permissions')
  @ApiOperation({
    summary: '매니저 권한 수정',
    description: '매니저의 권한을 수정합니다. 채널 소유자만 가능합니다.',
  })
  @ApiParam({ name: 'channelId', description: '채널 ID' })
  @ApiParam({ name: 'managerId', description: '매니저 ID' })
  @ApiResponse({ status: 200, type: ManagerDto })
  @ApiResponse({ status: 403, description: '채널 소유자만 가능' })
  @ApiResponse({ status: 404, description: '매니저를 찾을 수 없음' })
  async updateManagerPermissions(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('managerId', ParseIntPipe) managerId: number,
    @Body() dto: UpdateManagerPermissionsDto,
    @Request() req,
  ): Promise<ManagerDto> {
    return this.managerService.updateManagerPermissions(
      channelId,
      managerId,
      req.user.id,
      dto,
    );
  }

  @Delete(':managerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '매니저 삭제',
    description: '매니저를 삭제합니다. 채널 소유자만 가능합니다.',
  })
  @ApiParam({ name: 'channelId', description: '채널 ID' })
  @ApiParam({ name: 'managerId', description: '매니저 ID' })
  @ApiResponse({ status: 204, description: '삭제 완료' })
  @ApiResponse({ status: 403, description: '채널 소유자만 가능' })
  @ApiResponse({ status: 404, description: '매니저를 찾을 수 없음' })
  async removeManager(
    @Param('channelId', ParseIntPipe) channelId: number,
    @Param('managerId', ParseIntPipe) managerId: number,
    @Request() req,
  ): Promise<void> {
    return this.managerService.removeManager(channelId, managerId, req.user.id);
  }
}
