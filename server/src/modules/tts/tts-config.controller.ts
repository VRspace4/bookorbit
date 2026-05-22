import { Permission } from '@bookorbit/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateTtsConfigDto } from './dto/update-tts-config.dto';
import { TtsConfigService } from './tts-config.service';

@Controller('tts/providers')
@RequirePermission(Permission.ManageAppSettings)
export class TtsConfigController {
  constructor(private readonly service: TtsConfigService) {}

  @Get()
  async getConfig() {
    const config = await this.service.getConfig();
    const statuses = await this.service.getProviderStatuses(config);
    return { config, statuses };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() dto: UpdateTtsConfigDto) {
    return this.service.updateConfig(dto);
  }
}
